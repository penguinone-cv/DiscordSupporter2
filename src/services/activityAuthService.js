const DISCORD_API = 'https://discord.com/api/v10';
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export class ActivityAuthError extends Error {
    constructor(message, code, status) {
        super(message);
        this.name = 'ActivityAuthError';
        this.code = code;
        this.status = status;
    }
}

function unavailable() {
    return new ActivityAuthError('Discordとの通信に失敗しました。再試行してください', 'discord_unavailable', 503);
}

function notCurrentMember() {
    return new ActivityAuthError('このサーバーの現在のメンバーとして確認できませんでした', 'not_current_member', 403);
}

function validIdentifier(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,512}$/.test(value);
}

function validSecret(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

export class ActivityAuthService {
    constructor({ clientId, clientSecret, botToken, discordClient, sessionService,
        fetchFn = globalThis.fetch, requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS } = {}) {
        if (!validIdentifier(clientId) || !validSecret(clientSecret) || !validSecret(botToken)) {
            throw new Error('ActivityのDiscord認証設定が不足しています');
        }
        if (!discordClient?.guilds?.fetch || !sessionService?.issue || typeof fetchFn !== 'function') {
            throw new Error('Activity認証サービスの依存関係が不足しています');
        }
        if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0 || requestTimeoutMs > 60_000) {
            throw new Error('Activityの通信タイムアウトが不正です');
        }
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.botToken = botToken;
        this.discordClient = discordClient;
        this.sessionService = sessionService;
        this.fetchFn = fetchFn;
        this.requestTimeoutMs = requestTimeoutMs;
    }

    async withDeadline(operation, controller) {
        let timer;
        try {
            return await Promise.race([
                Promise.resolve().then(operation),
                new Promise((_resolve, reject) => {
                    timer = setTimeout(() => {
                        controller?.abort();
                        reject(unavailable());
                    }, this.requestTimeoutMs);
                })
            ]);
        } finally {
            clearTimeout(timer);
        }
    }

    async requestJson(url, options, failure) {
        const controller = new AbortController();
        try {
            return await this.withDeadline(async () => {
                const response = await this.fetchFn(url, { ...options, signal: controller.signal });
                if (!response.ok) {
                    // Never include Discord response bodies: they may contain credentials.
                    if (response.status === 429 || response.status >= 500) throw unavailable();
                    throw failure;
                }
                try {
                    return await response.json();
                } catch {
                    throw failure;
                }
            }, controller);
        } catch (error) {
            if (error instanceof ActivityAuthError) throw error;
            // Network errors can contain URLs or headers, so do not retain a cause.
            throw unavailable();
        }
    }

    async authenticateCode(request) {
        const { code, instanceId } = request ?? {};
        if (!validSecret(code) || code.length > 4096 || !validIdentifier(instanceId)) {
            throw new ActivityAuthError('Activityの認証リクエストが不正です', 'invalid_auth_request', 400);
        }
        const exchangeFailure = new ActivityAuthError(
            'Discord認証コードを交換できませんでした', 'oauth_exchange_failed', 401
        );
        const token = await this.requestJson('https://discord.com/api/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: this.clientId,
                client_secret: this.clientSecret,
                grant_type: 'authorization_code',
                code
            })
        }, exchangeFailure);
        if (!validSecret(token?.access_token) || !Number.isSafeInteger(token?.expires_in)
            || token.expires_in <= 0
            || (token.token_type !== undefined
                && (typeof token.token_type !== 'string' || token.token_type.toLowerCase() !== 'bearer'))) {
            throw exchangeFailure;
        }
        const identityFailure = new ActivityAuthError(
            'Discordの本人確認に失敗しました', 'oauth_identity_failed', 401
        );
        const user = await this.requestJson(`${DISCORD_API}/users/@me`, {
            headers: { Authorization: `Bearer ${token.access_token}` }
        }, identityFailure);
        if (!validIdentifier(user?.id) || user.bot) throw identityFailure;

        const instanceFailure = new ActivityAuthError(
            'このActivityの参加情報を確認できませんでした', 'invalid_activity_instance', 403
        );
        const instance = await this.requestJson(
            `${DISCORD_API}/applications/${this.clientId}/activity-instances/${instanceId}`,
            { headers: { Authorization: `Bot ${this.botToken}` } },
            instanceFailure
        );
        if (instance?.application_id !== this.clientId || instance?.instance_id !== instanceId
            || instance?.location?.kind !== 'gc'
            || !validIdentifier(instance.location.guild_id)
            || !validIdentifier(instance.location.channel_id)
            || !Array.isArray(instance.users) || !instance.users.includes(user.id)) {
            throw instanceFailure;
        }
        const guildId = instance.location.guild_id;
        await this.assertCurrentMember({ guildId, userId: user.id });
        return {
            accessToken: token.access_token,
            sessionToken: this.sessionService.issue({ userId: user.id, guildId, instanceId }),
            expiresIn: token.expires_in
        };
    }

    async assertCurrentMember({ guildId, userId } = {}) {
        if (!validIdentifier(guildId) || !validIdentifier(userId)) throw notCurrentMember();
        try {
            return await this.withDeadline(async () => {
                const guild = await this.discordClient.guilds.fetch(guildId);
                if (guild?.id !== guildId || !guild.members?.fetch) throw notCurrentMember();
                // A cached GuildMember may remain after departure; authorization always fetches.
                const member = await guild.members.fetch({ user: userId, force: true });
                if (member?.id !== userId || member?.user?.id !== userId || member.user.bot !== false) {
                    throw notCurrentMember();
                }
                return { guild, member };
            });
        } catch (error) {
            if (error instanceof ActivityAuthError) throw error;
            if (error?.status === 403 || error?.status === 404
                || [10004, 10007, 50001, 50013].includes(error?.code)) {
                throw notCurrentMember();
            }
            throw unavailable();
        }
    }
}

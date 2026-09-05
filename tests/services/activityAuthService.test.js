import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityAuthService } from '../../src/services/activityAuthService.js';

function response(body, { ok = true, status = 200 } = {}) {
    return {
        ok,
        status,
        json: vi.fn().mockResolvedValue(body)
    };
}

describe('ActivityAuthService', () => {
    let fetchFn;
    let member;
    let guild;
    let discordClient;
    let sessionService;
    let service;

    beforeEach(() => {
        member = { id: 'user-1', user: { id: 'user-1', bot: false } };
        guild = {
            id: 'guild-1',
            members: { fetch: vi.fn().mockResolvedValue(member) }
        };
        discordClient = {
            guilds: { fetch: vi.fn().mockResolvedValue(guild) }
        };
        sessionService = {
            issue: vi.fn().mockReturnValue('signed-session')
        };
        fetchFn = vi.fn()
            .mockResolvedValueOnce(response({
                access_token: 'oauth-access',
                token_type: 'Bearer',
                expires_in: 604800,
                refresh_token: 'never-return-this'
            }))
            .mockResolvedValueOnce(response({ id: 'user-1', username: 'Penguin' }))
            .mockResolvedValueOnce(response({
                application_id: 'client-1',
                instance_id: 'instance-1',
                location: { kind: 'gc', guild_id: 'guild-1', channel_id: 'channel-1' },
                users: ['user-1']
            }));
        service = new ActivityAuthService({
            clientId: 'client-1',
            clientSecret: 'client-secret',
            botToken: 'bot-token',
            discordClient,
            sessionService,
            fetchFn
        });
    });

    afterEach(() => vi.useRealTimers());

    it('OAuth本人・Activity instance・現在のguild memberを検証して短期セッションを発行する', async () => {
        const result = await service.authenticateCode({
            code: 'authorization-code',
            instanceId: 'instance-1'
        });

        expect(fetchFn).toHaveBeenNthCalledWith(1,
            'https://discord.com/api/oauth2/token',
            expect.objectContaining({ method: 'POST' })
        );
        const tokenBody = fetchFn.mock.calls[0][1].body;
        expect(Object.fromEntries(tokenBody)).toEqual({
            client_id: 'client-1',
            client_secret: 'client-secret',
            grant_type: 'authorization_code',
            code: 'authorization-code'
        });
        expect(fetchFn).toHaveBeenNthCalledWith(2,
            'https://discord.com/api/v10/users/@me',
            expect.objectContaining({ headers: { Authorization: 'Bearer oauth-access' } })
        );
        expect(fetchFn).toHaveBeenNthCalledWith(3,
            'https://discord.com/api/v10/applications/client-1/activity-instances/instance-1',
            expect.objectContaining({ headers: { Authorization: 'Bot bot-token' } })
        );
        expect(discordClient.guilds.fetch).toHaveBeenCalledWith('guild-1');
        expect(guild.members.fetch).toHaveBeenCalledWith({ user: 'user-1', force: true });
        expect(sessionService.issue).toHaveBeenCalledWith({
            userId: 'user-1',
            guildId: 'guild-1',
            instanceId: 'instance-1'
        });
        expect(result).toEqual({
            accessToken: 'oauth-access',
            sessionToken: 'signed-session',
            expiresIn: 604800
        });
        expect(JSON.stringify(result)).not.toContain('never-return-this');
    });

    it.each([
        ['application_id', { application_id: 'other-client' }],
        ['instance_id', { instance_id: 'other-instance' }],
        ['guild location', { location: { kind: 'pc', channel_id: 'channel-1' } }],
        ['participating user', { users: ['user-2'] }]
    ])('不一致なActivity instanceを拒否する: %s', async (_label, override) => {
        fetchFn.mockReset()
            .mockResolvedValueOnce(response({ access_token: 'oauth-access', expires_in: 10 }))
            .mockResolvedValueOnce(response({ id: 'user-1' }))
            .mockResolvedValueOnce(response({
                application_id: 'client-1',
                instance_id: 'instance-1',
                location: { kind: 'gc', guild_id: 'guild-1', channel_id: 'channel-1' },
                users: ['user-1'],
                ...override
            }));

        await expect(service.authenticateCode({
            code: 'authorization-code',
            instanceId: 'instance-1'
        })).rejects.toMatchObject({ code: 'invalid_activity_instance', status: 403 });
        expect(sessionService.issue).not.toHaveBeenCalled();
    });

    it('Botまたは退会済みユーザーを拒否する', async () => {
        guild.members.fetch.mockResolvedValue({
            id: 'user-1',
            user: { id: 'user-1', bot: true }
        });

        await expect(service.authenticateCode({
            code: 'authorization-code',
            instanceId: 'instance-1'
        })).rejects.toMatchObject({ code: 'not_current_member', status: 403 });
    });

    it('OAuth token交換失敗時にDiscordの応答本文や秘密値を露出しない', async () => {
        fetchFn.mockReset().mockResolvedValue(response(
            { error: 'invalid_grant', client_secret: 'leaked' },
            { ok: false, status: 400 }
        ));

        await expect(service.authenticateCode({
            code: 'bad-code',
            instanceId: 'instance-1'
        })).rejects.toMatchObject({
            message: 'Discord認証コードを交換できませんでした',
            code: 'oauth_exchange_failed',
            status: 401
        });
    });

    it('空の認証コードやinstance IDをDiscordへ送信しない', async () => {
        await expect(service.authenticateCode({ code: '', instanceId: 'instance-1' }))
            .rejects.toMatchObject({ code: 'invalid_auth_request', status: 400 });
        await expect(service.authenticateCode({ code: 'code', instanceId: '' }))
            .rejects.toMatchObject({ code: 'invalid_auth_request', status: 400 });
        expect(fetchFn).not.toHaveBeenCalled();
    });

    it.each([
        undefined, null, {}, { code: 42, instanceId: 'instance-1' },
        { code: ' ', instanceId: 'instance-1' },
        { code: 'code', instanceId: '../other?secret=value' },
        { code: 'code', instanceId: 'a'.repeat(513) }
    ])('不正な認証リクエストを拒否する: %j', async request => {
        await expect(service.authenticateCode(request))
            .rejects.toMatchObject({ code: 'invalid_auth_request', status: 400 });
        expect(fetchFn).not.toHaveBeenCalled();
    });

    it.each([
        { access_token: '', expires_in: 10 },
        { access_token: 'oauth-access', expires_in: 0 },
        { access_token: 'oauth-access', expires_in: '10' },
        { access_token: 'oauth-access', expires_in: 10, token_type: 'Other' },
        { access_token: 'oauth-access', expires_in: 10, token_type: null },
        { access_token: 'oauth-access', expires_in: 10, token_type: 42 }
    ])('不完全なOAuth応答を拒否する: %j', async body => {
        fetchFn.mockReset().mockResolvedValue(response(body));
        await expect(service.authenticateCode({ code: 'code', instanceId: 'instance-1' }))
            .rejects.toMatchObject({ code: 'oauth_exchange_failed', status: 401 });
        expect(sessionService.issue).not.toHaveBeenCalled();
    });

    it.each([0, 1, 2])('各Discord通信の例外から秘密値を隠す: %s', async index => {
        const responses = [
            response({ access_token: 'oauth-access', expires_in: 10 }),
            response({ id: 'user-1' })
        ];
        fetchFn.mockReset();
        responses.slice(0, index).forEach(value => fetchFn.mockResolvedValueOnce(value));
        fetchFn.mockRejectedValueOnce(new Error('client-secret oauth-access bot-token'));
        const error = await service.authenticateCode({ code: 'code', instanceId: 'instance-1' })
            .catch(value => value);
        expect(error).toMatchObject({ code: 'discord_unavailable', status: 503 });
        expect(String(error)).not.toMatch(/client-secret|oauth-access|bot-token/);
        expect(error.cause).toBeUndefined();
        expect(sessionService.issue).not.toHaveBeenCalled();
    });

    it('遅延したDiscord通信を中止し、秘密値のないエラーを返す', async () => {
        vi.useFakeTimers();
        let requestSignal;
        fetchFn.mockReset().mockImplementation((_url, { signal }) => {
            requestSignal = signal;
            return new Promise(() => {});
        });
        service = new ActivityAuthService({
            clientId: 'client-1', clientSecret: 'client-secret', botToken: 'bot-token',
            discordClient, sessionService, fetchFn, requestTimeoutMs: 50
        });
        const request = service.authenticateCode({ code: 'code', instanceId: 'instance-1' })
            .catch(value => value);
        await vi.advanceTimersByTimeAsync(50);
        expect(await request).toMatchObject({ code: 'discord_unavailable', status: 503 });
        expect(requestSignal.aborted).toBe(true);
        expect(sessionService.issue).not.toHaveBeenCalled();
    });

    it('所属確認で取得済みキャッシュを使わず本人の現在情報を返す', async () => {
        expect(await service.assertCurrentMember({ guildId: 'guild-1', userId: 'user-1' }))
            .toEqual({ guild, member });
        expect(guild.members.fetch).toHaveBeenCalledWith({ user: 'user-1', force: true });
    });

    it.each([
        null,
        { id: 'user-2', user: { id: 'user-2', bot: false } },
        { id: 'user-1', user: { id: 'user-1', bot: true } }
    ])('不在・別人・Botを所属済みとして扱わない: %j', async result => {
        guild.members.fetch.mockResolvedValue(result);
        await expect(service.assertCurrentMember({ guildId: 'guild-1', userId: 'user-1' }))
            .rejects.toMatchObject({ code: 'not_current_member', status: 403 });
    });

    it('退会者に対するDiscord 404を拒否する', async () => {
        guild.members.fetch.mockRejectedValue({ code: 10007, status: 404 });
        await expect(service.assertCurrentMember({ guildId: 'guild-1', userId: 'user-1' }))
            .rejects.toMatchObject({ code: 'not_current_member', status: 403 });
    });

    it('不明なギルドを拒否する', async () => {
        discordClient.guilds.fetch.mockResolvedValue(null);
        await expect(service.assertCurrentMember({ guildId: 'guild-1', userId: 'user-1' }))
            .rejects.toMatchObject({ code: 'not_current_member', status: 403 });
    });

    it('Discord 429や5xxを認証失敗と混同しない', async () => {
        fetchFn.mockReset().mockResolvedValue(response({}, { ok: false, status: 429 }));
        await expect(service.authenticateCode({ code: 'code', instanceId: 'instance-1' }))
            .rejects.toMatchObject({ code: 'discord_unavailable', status: 503 });
    });

    it('本人確認に失敗した応答から秘密値を返さない', async () => {
        fetchFn.mockReset()
            .mockResolvedValueOnce(response({ access_token: 'oauth-access', expires_in: 10 }))
            .mockResolvedValueOnce(response({ message: 'oauth-access' }, { ok: false, status: 401 }));
        await expect(service.authenticateCode({ code: 'code', instanceId: 'instance-1' }))
            .rejects.toMatchObject({ code: 'oauth_identity_failed', status: 401 });
        expect(sessionService.issue).not.toHaveBeenCalled();
    });

    it('Activity Instance API拒否時にセッションを発行しない', async () => {
        fetchFn.mockReset()
            .mockResolvedValueOnce(response({ access_token: 'oauth-access', expires_in: 10 }))
            .mockResolvedValueOnce(response({ id: 'user-1' }))
            .mockResolvedValueOnce(response({ message: 'bot-token' }, { ok: false, status: 404 }));
        await expect(service.authenticateCode({ code: 'code', instanceId: 'instance-1' }))
            .rejects.toMatchObject({ code: 'invalid_activity_instance', status: 403 });
        expect(sessionService.issue).not.toHaveBeenCalled();
    });

    it('所属確認の一時障害を退会と混同しない', async () => {
        guild.members.fetch.mockRejectedValue(new Error('bot-token'));
        const error = await service.assertCurrentMember({ guildId: 'guild-1', userId: 'user-1' })
            .catch(value => value);
        expect(error).toMatchObject({ code: 'discord_unavailable', status: 503 });
        expect(String(error)).not.toContain('bot-token');
    });
});

import { createHmac, timingSafeEqual } from 'node:crypto';

const DEFAULT_TTL_SECONDS = 5 * 60;

export class ActivitySessionError extends Error {
    constructor(message, code = 'invalid_session') {
        super(message);
        this.name = 'ActivitySessionError';
        this.code = code;
        this.status = 401;
    }
}

function encode(value) {
    return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decode(value) {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

export class ActivitySessionService {
    constructor({ secret, ttlSeconds = DEFAULT_TTL_SECONDS, now = () => new Date() } = {}) {
        if (typeof secret !== 'string' || !secret) throw new Error('Activityセッションの秘密値が設定されていません');
        if (secret.length < 32) {
            throw new Error('Activityセッションの秘密値は32文字以上にしてください');
        }
        if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 3600) {
            throw new Error('Activityセッションの有効期限は30〜3600秒で指定してください');
        }
        this.secret = secret;
        this.ttlSeconds = ttlSeconds;
        this.now = now;
    }

    signature(payload) {
        return createHmac('sha256', this.secret).update(payload).digest('base64url');
    }

    issue({ userId, guildId, instanceId }) {
        if (![userId, guildId, instanceId].every(value => typeof value === 'string' && value)) {
            throw new Error('Activityセッション情報が不足しています');
        }
        const issuedAt = Math.floor(this.now().getTime() / 1000);
        const body = encode({
            version: 1,
            userId,
            guildId,
            instanceId,
            issuedAt,
            expiresAt: issuedAt + this.ttlSeconds
        });
        return `${body}.${this.signature(body)}`;
    }

    verify(token) {
        try {
            if (typeof token !== 'string' || token.length > 8192) throw new Error('invalid');
            const [body, providedSignature, ...extra] = token.split('.');
            if (!body || !providedSignature || extra.length) throw new Error('invalid');
            const expected = Buffer.from(this.signature(body), 'utf8');
            const provided = Buffer.from(providedSignature, 'utf8');
            if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
                throw new Error('invalid');
            }
            const payload = decode(body);
            if (payload.version !== 1
                || ![payload.userId, payload.guildId, payload.instanceId]
                    .every(value => typeof value === 'string' && value)
                || !Number.isSafeInteger(payload.issuedAt)
                || !Number.isSafeInteger(payload.expiresAt)) {
                throw new Error('invalid');
            }
            const nowSeconds = Math.floor(this.now().getTime() / 1000);
            if (payload.issuedAt > nowSeconds || payload.expiresAt <= payload.issuedAt
                || payload.expiresAt - payload.issuedAt > 3600) {
                throw new Error('invalid');
            }
            if (payload.expiresAt <= nowSeconds) {
                throw new ActivitySessionError(
                    'Activityセッションの有効期限が切れています',
                    'session_expired'
                );
            }
            return {
                userId: payload.userId,
                guildId: payload.guildId,
                instanceId: payload.instanceId,
                issuedAt: payload.issuedAt,
                expiresAt: payload.expiresAt
            };
        } catch (error) {
            if (error instanceof ActivitySessionError) throw error;
            throw new ActivitySessionError('Activityセッションが無効です');
        }
    }
}

export { DEFAULT_TTL_SECONDS };

import express from 'express';

function invalidRequest() {
    return Object.assign(new Error('入力内容を確認してください'), { status: 400, code: 'invalid_request' });
}

function bodyFields(body, fields) {
    if (!body || Array.isArray(body) || typeof body !== 'object'
        || Object.keys(body).some(key => !fields.includes(key))) throw invalidRequest();
    return Object.fromEntries(fields.map(key => [key, body[key]]));
}

function positiveId(value) {
    if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) throw invalidRequest();
    return Number(value);
}

function rateLimit(limit, keyOf) {
    const buckets = new Map();
    return (req, res, next) => {
        const now = Date.now();
        for (const [key, bucket] of buckets) if (bucket.until <= now) buckets.delete(key);
        const key = keyOf(req);
        const bucket = buckets.get(key) ?? { count: 0, until: now + 60000 };
        bucket.count += 1;
        buckets.set(key, bucket);
        if (bucket.count > limit) {
            res.set('Retry-After', String(Math.ceil((bucket.until - now) / 1000)));
            return res.status(429).json({ error: { code: 'rate_limited', message: '少し待ってから再試行してください' } });
        }
        next();
    };
}

export function createActivityScheduleRouter({ enabled, clientId, authService, sessionService, scheduleService }) {
    const router = express.Router();
    const route = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res, next)).catch(next);
    router.use((_req, res, next) => {
        res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
        next();
    });
    router.use(express.json({ limit: '8kb' }));
    router.get('/bootstrap', (_req, res) => res.json({ enabled: Boolean(enabled), clientId: enabled ? clientId : null }));
    router.use((_req, res, next) => enabled
        ? next()
        : res.status(503).json({ error: { code: 'activity_disabled', message: 'カレンダーは準備中です。週表示をご利用ください。' } }));
    router.post('/session', rateLimit(40, req => req.ip), route(async (req, res) => {
        const input = bodyFields(req.body, ['code', 'instanceId']);
        res.json(await authService.authenticateCode(input));
    }));
    router.use(route(async (req, res, next) => {
        const match = /^Bearer ([^\s]+)$/.exec(req.get('Authorization') ?? '');
        if (!match) return res.status(401).json({ error: { code: 'authentication_required', message: 'Discordから起動してください' } });
        req.activityIdentity = sessionService.verify(match[1]);
        next();
    }));
    router.use(rateLimit(240, req => `${req.activityIdentity.guildId}:${req.activityIdentity.userId}`));
    router.use(route(async (req, _res, next) => {
        const { guild } = await authService.assertCurrentMember(req.activityIdentity);
        req.activityGuild = guild;
        // Continue only after both the signature and current membership have been checked.
        next();
    }));
    const owner = req => ({ guildId: req.activityIdentity.guildId, userId: req.activityIdentity.userId });
    router.get('/month', route(async (req, res) => {
        if (Object.keys(req.query).some(key => key !== 'offset')) throw invalidRequest();
        const offset = req.query.offset ?? '0';
        if (!['0', '1'].includes(offset)) throw invalidRequest();
        res.json(await scheduleService.getMonth(req.activityGuild, req.activityIdentity.userId, Number(offset)));
    }));
    router.get('/months/:monthId/days/:localDate', route(async (req, res) => {
        res.json(await scheduleService.getDay(req.activityGuild, req.activityIdentity.userId, positiveId(req.params.monthId), req.params.localDate));
    }));
    router.put('/months/:monthId/slots/:slotId', route(async (req, res) => {
        const { status } = bodyFields(req.body, ['status']);
        res.json(await scheduleService.setStatus({ ...owner(req), monthId: positiveId(req.params.monthId), slotId: positiveId(req.params.slotId), status }));
    }));
    for (const [path, method, fields] of [
        ['/range-reset/preview', 'previewReset', ['monthId', 'startDate', 'endDate']],
        ['/range-reset', 'resetRange', ['monthId', 'startDate', 'endDate', 'revision']]
    ]) {
        router.post(path, route(async (req, res) => {
            const input = bodyFields(req.body, fields);
            input.monthId = positiveId(input.monthId);
            res.json(await scheduleService[method]({ ...owner(req), ...input }));
        }));
    }
    router.use((_req, res) => res.status(405).json({ error: { code: 'method_not_allowed', message: 'この操作には対応していません' } }));
    router.use((error, _req, res, _next) => {
        if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') error = invalidRequest();
        const expected = [400, 401, 403, 404, 409, 429, 503].includes(error.status) && typeof error.code === 'string';
        res.status(expected ? error.status : 503).json({
            error: expected ? { code: error.code, message: error.message }
                : { code: 'service_unavailable', message: '予定を取得・保存できませんでした。時間をおいて再試行してください。' }
        });
    });
    return router;
}

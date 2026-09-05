import { Collection } from 'discord.js';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import config from '../../src/config/configLoader.js';
import database from '../../src/repositories/database.js';
import availabilityRepository from '../../src/repositories/availabilityRepository.js';
import { ActivitySessionService } from '../../src/services/activitySessionService.js';
import scheduleService from '../../src/services/scheduleService.js';
import webServer from '../../src/services/webServer.js';

const BASE = '/api/activity/schedule';
const GUILD_ID = 'integration-guild';
const MONDAY = '2026-09-07';
const TUESDAY = '2026-09-08';
const SESSION_SECRET = 'integration-test-session-secret-not-for-production';

describe('Activity HTTP / authentication / SQLite integration', () => {
    let originalConfig;
    let originalApp;
    let guild;
    let sessionService;
    let externalFetch;

    beforeEach(() => {
        originalConfig = config.config;
        originalApp = webServer.app;
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-09-05T00:00:00Z'));
        externalFetch = vi.fn().mockRejectedValue(new Error('External HTTP is forbidden in integration tests'));
        vi.stubGlobal('fetch', externalFetch);
        database.close();
        database.initialize(':memory:');
        config.config = {
            discord: { clientId: 'integration-app', clientSecret: 'test-only-client-secret', token: 'test-only-bot-token' },
            activity: { enabled: true, sessionSecret: SESSION_SECRET, sessionTtlSeconds: 300 },
            webui: { enabled: true }
        };
        const cache = new Collection([
            ['self', { id: 'self', displayName: 'ペンギン', user: { id: 'self', bot: false } }],
            ['other', { id: 'other', displayName: 'あざらし', user: { id: 'other', bot: false } }],
            ['bot', { id: 'bot', displayName: 'Bot', user: { id: 'bot', bot: true } }]
        ]);
        guild = {
            id: GUILD_ID, memberCount: cache.size,
            members: { cache, fetch: vi.fn(async ({ user } = {}) => user ? cache.get(user) : cache) }
        };
        const discordClient = {
            guilds: { fetch: vi.fn(async id => id === GUILD_ID ? guild : null) }
        };
        sessionService = new ActivitySessionService({ secret: SESSION_SECRET, ttlSeconds: 300 });
        webServer.initialize({ discordClient });
    });

    afterEach(() => {
        const externalCalls = externalFetch.mock.calls.length;
        database.close();
        config.config = originalConfig;
        webServer.app = originalApp;
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        vi.useRealTimers();
        expect(externalCalls).toBe(0);
    });

    function authorized(httpRequest, userId = 'self') {
        const token = sessionService.issue({ userId, guildId: GUILD_ID, instanceId: 'integration-instance' });
        return httpRequest.set('Authorization', `Bearer ${token}`);
    }

    async function readMonth() {
        const result = await authorized(request(webServer.app).get(`${BASE}/month?offset=0`));
        expect(result.status).toBe(200);
        expect(result.headers['cache-control']).toBe('no-store');
        return result.body;
    }

    async function readDay(monthId, date = MONDAY) {
        const result = await authorized(request(webServer.app).get(`${BASE}/months/${monthId}/days/${date}`));
        expect(result.status).toBe(200);
        return result.body;
    }

    function putStatus(monthId, slotId, status, userId = 'self') {
        return authorized(request(webServer.app).put(`${BASE}/months/${monthId}/slots/${slotId}`), userId)
            .send({ status });
    }

    it('月表示→詳細→本人保存→範囲確認→復元が実DBを介して共有表示へ反映される', async () => {
        const template = availabilityRepository.ensureDefaultTemplates(GUILD_ID)
            .find(item => item.slot_key === 'weekday-night');
        availabilityRepository.setBasicStatus({
            guildId: GUILD_ID, userId: 'self', templateId: template.id, dayRule: '1', status: 'available'
        });
        const first = await readMonth();
        expect(first).toMatchObject({
            month: { year: 2026, month: 9, timezone: 'Asia/Tokyo' },
            memberCount: 2, selfUserId: 'self', today: '2026-09-05'
        });
        const monday = first.slots.find(slot => slot.localDate === MONDAY);
        const tuesday = first.slots.find(slot => slot.localDate === TUESDAY);
        expect(monday).toMatchObject({
            selfStatus: 'available', counts: { available: 1, maybe: 0, unavailable: 0, unset: 1 }
        });
        const initialDay = await readDay(first.month.id);
        expect(initialDay.slots[0].members).toEqual([
            { userId: 'self', displayName: 'ペンギン', status: 'available', isSelf: true },
            { userId: 'other', displayName: 'あざらし', status: 'unregistered', isSelf: false }
        ]);
        expect((await putStatus(first.month.id, monday.id, 'maybe', 'other')).status).toBe(200);
        expect((await putStatus(first.month.id, monday.id, 'unavailable')).body)
            .toEqual({ slotId: monday.id, status: 'unavailable' });
        expect((await putStatus(first.month.id, tuesday.id, 'maybe')).status).toBe(200);
        const changed = await readMonth();
        expect(changed.slots.find(slot => slot.id === monday.id)).toMatchObject({
            selfStatus: 'unavailable', counts: { available: 0, maybe: 1, unavailable: 1, unset: 0 }
        });
        const range = { monthId: first.month.id, startDate: MONDAY, endDate: TUESDAY };
        const preview = await authorized(request(webServer.app).post(`${BASE}/range-reset/preview`)).send(range);
        expect(preview.status).toBe(200);
        expect(preview.body).toMatchObject({ ...range, slotCount: 2 });
        expect(preview.body.revision).toMatch(/^[a-f0-9]{64}$/);
        const reset = await authorized(request(webServer.app).post(`${BASE}/range-reset`))
            .send({ ...range, revision: preview.body.revision });
        expect(reset.status).toBe(200);
        expect(reset.body).toEqual({ slotCount: 2 });
        const restored = await readMonth();
        expect(restored.slots.find(slot => slot.id === monday.id)).toMatchObject({
            selfStatus: 'available', counts: { available: 1, maybe: 1, unavailable: 0, unset: 0 }
        });
        expect((await readDay(first.month.id, TUESDAY)).slots[0].members[0].status).toBe('unset');
        expect((await readDay(first.month.id)).slots[0].members[1].status).toBe('maybe');
        expect(guild.members.fetch).toHaveBeenCalledWith({ user: 'self', force: true });
    });

    it.each([{ userId: 'other' }, { guildId: 'other-guild' }])('本文から認証本人やguildを上書きできない: %j', async extra => {
        const month = await readMonth();
        const slot = month.slots.find(item => item.localDate === MONDAY);
        const update = await authorized(request(webServer.app).put(`${BASE}/months/${month.month.id}/slots/${slot.id}`))
            .send({ status: 'available', ...extra });
        expect(update.status).toBe(400);
        const range = { monthId: month.month.id, startDate: MONDAY, endDate: MONDAY, ...extra };
        expect((await authorized(request(webServer.app).post(`${BASE}/range-reset/preview`)).send(range)).status).toBe(400);
        expect((await authorized(request(webServer.app).post(`${BASE}/range-reset`))
            .send({ ...range, revision: 'a'.repeat(64) })).status).toBe(400);
        expect((await readDay(month.month.id)).slots[0].members.map(member => member.status))
            .toEqual(['unregistered', 'unregistered']);
    });

    it('他guildの月・slotを指定しても読み書きできない', async () => {
        const ownMonth = await readMonth();
        const foreignMonth = scheduleService.ensureMonth('foreign-guild', 2026, 9);
        const foreignSlot = availabilityRepository.listMonthSlots('foreign-guild', foreignMonth.id)[0];
        availabilityRepository.setUserSlotStatus({
            guildId: 'foreign-guild', userId: 'self', slotId: foreignSlot.id, status: 'maybe'
        });
        expect((await putStatus(ownMonth.month.id, foreignSlot.id, 'available')).status).toBe(404);
        expect((await putStatus(foreignMonth.id, foreignSlot.id, 'available')).status).toBe(404);
        expect((await authorized(request(webServer.app)
            .get(`${BASE}/months/${foreignMonth.id}/days/2026-09-01`))).status).toBe(404);
        expect(availabilityRepository.findUserSlot('foreign-guild', 'self', foreignSlot.id).status).toBe('maybe');
    });

    it('プレビュー後に本人が保存すると旧revisionは409となり更新を消さない', async () => {
        const month = await readMonth();
        const slot = month.slots.find(item => item.localDate === MONDAY);
        const range = { monthId: month.month.id, startDate: MONDAY, endDate: MONDAY };
        const preview = await authorized(request(webServer.app).post(`${BASE}/range-reset/preview`)).send(range);
        expect(preview.status).toBe(200);
        expect((await putStatus(month.month.id, slot.id, 'unavailable')).status).toBe(200);
        const stale = await authorized(request(webServer.app).post(`${BASE}/range-reset`))
            .send({ ...range, revision: preview.body.revision });
        expect(stale.status).toBe(409);
        expect(stale.body.error.code).toBe('RESET_CONFLICT');
        expect((await readDay(month.month.id)).slots[0].members[0].status).toBe('unavailable');
    });

    it('実署名の改ざん・期限切れは所属照会前に拒否する', async () => {
        const token = sessionService.issue({ userId: 'self', guildId: GUILD_ID, instanceId: 'integration-instance' });
        const forged = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;
        expect((await request(webServer.app).get(`${BASE}/month`).set('Authorization', `Bearer ${forged}`)).status).toBe(401);
        vi.setSystemTime(new Date('2026-09-05T00:05:00Z'));
        const expired = await request(webServer.app).get(`${BASE}/month`).set('Authorization', `Bearer ${token}`);
        expect(expired.status).toBe(401);
        expect(expired.body.error.code).toBe('session_expired');
        expect(guild.members.fetch).not.toHaveBeenCalled();
    });
});

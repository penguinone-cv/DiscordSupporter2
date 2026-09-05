import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createActivityScheduleRouter } from '../../src/routes/activityScheduleRouter.js';

describe('Activity schedule API', () => {
    let app, authService, sessionService, scheduleService;
    const identity = { userId: 'self', guildId: 'guild', instanceId: 'instance' };
    const guild = { id: 'guild' };
    beforeEach(() => {
        authService = {
            authenticateCode: vi.fn().mockResolvedValue({ sessionToken: 'session', accessToken: 'oauth' }),
            assertCurrentMember: vi.fn().mockResolvedValue({ guild, member: { id: 'self' } })
        };
        sessionService = { verify: vi.fn().mockReturnValue(identity), ttlSeconds: 300 };
        scheduleService = {
            getMonth: vi.fn().mockResolvedValue({ month: { id: 1 }, slots: [] }),
            getDay: vi.fn().mockResolvedValue({ localDate: '2026-09-05', slots: [] }),
            setStatus: vi.fn().mockReturnValue({ slotId: 2, status: 'maybe' }),
            previewReset: vi.fn().mockReturnValue({ revision: 'revision', slotCount: 2 }),
            resetRange: vi.fn().mockReturnValue({ slotCount: 2 })
        };
        app = express();
        app.use('/api/activity/schedule', createActivityScheduleRouter({
            enabled: true, clientId: 'public-app-id', authService, sessionService, scheduleService
        }));
    });
    const base = '/api/activity/schedule';
    const authorized = req => req.set('Authorization', 'Bearer session');

    it('bootstrap以外の予定は未認証で返さず、キャッシュしない', async () => {
        const result = await request(app).get(`${base}/month`);
        expect(result.status).toBe(401);
        expect(result.headers['cache-control']).toContain('no-store');
        expect(scheduleService.getMonth).not.toHaveBeenCalled();
        const bootstrap = await request(app).get(`${base}/bootstrap`);
        expect(bootstrap.body).toEqual({ enabled: true, clientId: 'public-app-id' });
    });
    it('毎回セッション本人の現所属を検証してguildを固定する', async () => {
        const result = await authorized(request(app).get(`${base}/month?offset=1`));
        expect(result.status).toBe(200);
        expect(authService.assertCurrentMember).toHaveBeenCalledWith(identity);
        expect(scheduleService.getMonth).toHaveBeenCalledWith(guild, 'self', 1);
    });
    it('認証コードとinstanceだけを交換する', async () => {
        const result = await request(app).post(`${base}/session`).send({ code: 'code', instanceId: 'instance' });
        expect(result.status).toBe(200);
        expect(authService.authenticateCode).toHaveBeenCalledWith({ code: 'code', instanceId: 'instance' });
        expect(result.body.sessionToken).toBe('session');
    });
    it('更新対象本人はセッションから取得する', async () => {
        const result = await authorized(request(app).put(`${base}/months/1/slots/2`)).send({ status: 'maybe' });
        expect(result.status).toBe(200);
        expect(scheduleService.setStatus).toHaveBeenCalledWith({ guildId: 'guild', userId: 'self', monthId: 1, slotId: 2, status: 'maybe' });
    });
    it.each([{ userId: 'other' }, { guildId: 'other' }])('本人・guildの上書きを拒否する %j', async extra => {
        const result = await authorized(request(app).put(`${base}/months/1/slots/2`)).send({ status: 'maybe', ...extra });
        expect(result.status).toBe(400);
        expect(scheduleService.setStatus).not.toHaveBeenCalled();
    });
    it('日付詳細と復元プレビューを返し、古いrevisionは409で無変更', async () => {
        expect((await authorized(request(app).get(`${base}/months/1/days/2026-09-05`))).status).toBe(200);
        const range = { monthId: 1, startDate: '2026-09-05', endDate: '2026-09-06' };
        expect((await authorized(request(app).post(`${base}/range-reset/preview`)).send(range)).body.revision).toBe('revision');
        scheduleService.resetRange.mockImplementation(() => { throw Object.assign(new Error('再確認してください'), { status: 409, code: 'range_conflict' }); });
        const result = await authorized(request(app).post(`${base}/range-reset`)).send({ ...range, revision: 'old' });
        expect(result.status).toBe(409);
        expect(result.body.error.code).toBe('range_conflict');
    });
    it('退会後のアクセスを拒否し、想定外エラーに内部情報を含めない', async () => {
        authService.assertCurrentMember.mockRejectedValueOnce(Object.assign(new Error('退会済み'), { status: 403, code: 'not_current_member' }));
        expect((await authorized(request(app).get(`${base}/month`))).status).toBe(403);
        scheduleService.getMonth.mockRejectedValue(new Error('secret /internal/path'));
        const result = await authorized(request(app).get(`${base}/month`));
        expect(result.status).toBe(503);
        expect(JSON.stringify(result.body)).not.toContain('secret');
    });
    it('不正JSON、無効なoffset、未知のメソッドを拒否する', async () => {
        expect((await request(app).post(`${base}/session`).type('json').send('{bad')).status).toBe(400);
        expect((await authorized(request(app).get(`${base}/month?offset=2`))).status).toBe(400);
        expect((await authorized(request(app).delete(`${base}/month`))).status).toBe(405);
    });
    it('レート制限超過時はDiscord所属照会より先に拒否する', async () => {
        for (let i = 0; i < 240; i++) await authorized(request(app).get(`${base}/month`));
        expect((await authorized(request(app).get(`${base}/month`))).status).toBe(429);
        expect(authService.assertCurrentMember).toHaveBeenCalledTimes(240);
    });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import config from '../../src/config/configLoader.js';
import webServer from '../../src/services/webServer.js';

describe('WebServer Activity isolation', () => {
    afterEach(() => { config.config = null; vi.restoreAllMocks(); });
    it('既存ダッシュボードと分離したAPIをmountする', async () => {
        config.config = { activity: { enabled: false } };
        webServer.initialize();
        const response = await request(webServer.app).get('/api/activity/schedule/bootstrap');
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ enabled: false, clientId: null });
        expect((await request(webServer.app).get('/api/health')).status).toBe(200);
        expect((await request(webServer.app).get('/')).status).toBe(200);
    });
    it('Activity本文上限は全体のJSON parserより先に適用する', async () => {
        config.config = { activity: { enabled: false } };
        webServer.initialize();
        const response = await request(webServer.app).post('/api/activity/schedule/session').send({ code: 'x'.repeat(9000) });
        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('invalid_request');
        expect(response.headers['cache-control']).toBe('no-store');
    });
});

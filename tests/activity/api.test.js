import { describe, expect, it, vi } from 'vitest';
import { createApi } from '../../activity/src/api.js';

describe('Activity API client', () => {
    it('セッションはメモリで保持し、更新bodyに本人・guildを追加しない', async () => {
        const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'maybe' }) });
        const api = createApi({ fetchFn });
        api.setToken('session');
        await api.request('/months/1/slots/2', { method: 'PUT', body: { status: 'maybe' } });
        expect(fetchFn.mock.calls[0][0]).toBe('/api/activity/schedule/months/1/slots/2');
        expect(fetchFn.mock.calls[0][1].headers.Authorization).toBe('Bearer session');
        expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toEqual({ status: 'maybe' });
    });
    it('期限切れは一度だけ再認証し、競合は自動再送しない', async () => {
        const fetchFn = vi.fn()
            .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: { message: '期限切れ' } }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ slots: [] }) })
            .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: { code: 'range_conflict', message: '再確認' } }) });
        const api = createApi({ fetchFn });
        const refresh = vi.fn().mockResolvedValue(undefined);
        api.setReauthenticate(refresh);
        await api.request('/month');
        expect(refresh).toHaveBeenCalledOnce();
        await expect(api.request('/range-reset', { method: 'POST', body: {} })).rejects.toMatchObject({ status: 409 });
        expect(fetchFn).toHaveBeenCalledTimes(3);
    });
    it('並行した401は再認証を共有し、再認証後の401は無限再試行しない', async () => {
        const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: { message: '期限切れ' } }) });
        const api = createApi({ fetchFn });
        let complete;
        const reauthenticate = vi.fn(() => new Promise(resolve => { complete = resolve; }));
        api.setReauthenticate(reauthenticate);
        const results = Promise.allSettled([api.request('/month'), api.request('/month')]);
        await vi.waitFor(() => expect(reauthenticate).toHaveBeenCalledOnce());
        complete();
        expect((await results).every(result => result.status === 'rejected')).toBe(true);
        expect(fetchFn).toHaveBeenCalledTimes(4);
    });
});

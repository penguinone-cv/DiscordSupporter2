// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCandidateApp } from '../../activity/src/candidateApp.js';

describe('候補カレンダー', () => {
    let root, api, app, data;
    beforeEach(() => {
        root = document.createElement('div'); document.body.append(root);
        data = {
            month: { id: 1, year: 2026, month: 9, timezone: 'Asia/Tokyo' }, today: '2026-09-07',
            game: { id: 2, displayName: 'Game', channelId: 'channel' },
            candidates: Array.from({ length: 12 }, (_, i) => ({ slotId: i + 1, localDate: `2026-09-${String(i + 7).padStart(2, '0')}`, label: '昼', availableCount: 1, maybeCount: 0, unavailableCount: 0, members: [{ displayName: '<img src=x>', userId: 'u', status: 'available' }], recruitment: null }))
        };
        api = { request: vi.fn(async path => path === '/candidate-games' ? { games: [data.game] } : structuredClone(data)) };
        app = createCandidateApp(root, { api }); app.setLayoutMode(0);
    });
    afterEach(() => { app.destroy(); root.remove(); vi.useRealTimers(); });
    async function choose() { await app.start(); await app.selectGame('2'); }
    it('初期未選択、月内全候補、名前の安全な表示、明示操作だけで募集する', async () => {
        await app.start();
        expect(api.request).toHaveBeenCalledTimes(1);
        await app.selectGame('2');
        expect(root.querySelectorAll('[data-date]')).toHaveLength(30);
        root.querySelector('[data-date="2026-09-18"]').focus();
        await app.selectDate('2026-09-18');
        expect(root.querySelector('[role=dialog]').contains(document.activeElement)).toBe(true);
        expect(root.textContent).toContain('<img src=x>');
        expect(root.querySelector('img')).toBeNull();
        expect(api.request.mock.calls.some(([path]) => path === '/recruitments')).toBe(false);
        root.querySelector('[data-recruit="12"]').click();
        await vi.waitFor(() => expect(api.request).toHaveBeenCalledWith('/recruitments', { method: 'POST', body: { monthId: 1, gameId: 2, slotId: 12 } }));
    });
    it('募集済みは再投稿できず、PIPに操作を出さない', async () => {
        data.candidates[0].recruitment = { id: 1, status: 'open' };
        await choose(); await app.selectDate('2026-09-07');
        expect(root.querySelector('[data-recruit="1"]').disabled).toBe(true);
        expect(root.textContent).toContain('募集中');
        app.setLayoutMode(1);
        expect(root.querySelector('[data-recruit]')).toBeNull();
    });
    it('通信結果不明でも募集POSTを再送せず、再取得した状態で再投稿を防ぐ', async () => {
        await choose(); await app.selectDate('2026-09-07');
        api.request.mockImplementation(async path => {
            if (path === '/recruitments') { data.candidates[0].recruitment = { id: 1, status: 'open' }; throw new Error('通信できません'); }
            return structuredClone(data);
        });
        root.querySelector('[data-recruit="1"]').click(); root.querySelector('[data-recruit="1"]')?.click();
        await vi.waitFor(() => expect(root.textContent).toContain('募集中'));
        expect(api.request.mock.calls.filter(([path]) => path === '/recruitments')).toHaveLength(1);
        expect(root.querySelector('[data-recruit="1"]').disabled).toBe(true);
    });
    it('ゲーム切替後に古い応答を表示しない', async () => {
        await choose();
        let resolve;
        api.request.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
        const pending = app.refresh();
        await app.selectGame('');
        resolve(structuredClone(data)); await pending;
        expect(root.querySelector('[data-date]')).toBeNull();
    });
    it('候補消失後は投稿操作を表示せず、所属エラー後は回答を消す', async () => {
        await choose(); await app.selectDate('2026-09-07');
        data.candidates = [];
        await app.refresh();
        expect(root.querySelector('[data-recruit]')).toBeNull();
        expect(root.textContent).toContain('候補はなくなりました');
        api.request.mockRejectedValueOnce(Object.assign(new Error('アクセスできません'), { status: 403 }));
        await app.refresh();
        expect(root.querySelector('[data-date]')).toBeNull();
        expect(root.querySelector('[role=dialog]')).toBeNull();
    });
    it('表示中のみ定期更新し、Escapeで詳細から日付に戻る', async () => {
        await choose(); await app.selectDate('2026-09-07');
        root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(root.querySelector('[role=dialog]')).toBeNull();
        expect(document.activeElement.dataset.date).toBe('2026-09-07');
        vi.useFakeTimers();
        await app.refresh(); const before = api.request.mock.calls.length;
        await vi.advanceTimersByTimeAsync(5000);
        expect(api.request.mock.calls.length).toBeGreaterThan(before);
        app.setLayoutMode(1); const paused = api.request.mock.calls.length;
        await vi.advanceTimersByTimeAsync(15000);
        expect(api.request.mock.calls.length).toBe(paused);
    });
});

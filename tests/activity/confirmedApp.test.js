// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConfirmedApp } from '../../activity/src/confirmedApp.js';

describe('確定済み予定カレンダー', () => {
    let root, api, app, data;
    beforeEach(() => {
        root = document.createElement('div'); document.body.append(root);
        data = {
            month: { year: 2026, month: 1, timezone: 'Asia/Tokyo' }, today: '2026-01-05',
            channels: [{ id: 'c', name: 'game' }, { id: 'other', name: 'other-game' }],
            events: [{ id: 'event', channelId: 'c', channelName: 'game', localDate: '2026-01-05', content: '<img src=x>\n確定した予定' }],
            relatedEvents: [{ id: 'related', channelId: 'other', channelName: 'other-game', localDate: '2026-01-05', content: '他の予定', memberNames: ['<script>ペンギン</script>'] }]
        };
        api = { request: vi.fn(async () => structuredClone(data)) };
        app = createConfirmedApp(root, { api }); app.setLayoutMode(0);
    });
    afterEach(() => { app.destroy(); root.remove(); vi.useRealTimers(); });

    it('日付の詳細に本文と関連メンバーを安全に表示し、Escapeで日付に戻る', async () => {
        await app.start();
        expect(api.request).toHaveBeenCalledWith('/calendar');
        expect(root.querySelectorAll('[data-date]')).toHaveLength(31);
        root.querySelector('[data-date="2026-01-05"]').click();
        const dialog = root.querySelector('[role=dialog]');
        expect(dialog.contains(document.activeElement)).toBe(true);
        expect(dialog.textContent).toContain('<img src=x>\n確定した予定');
        expect(dialog.textContent).toContain('<script>ペンギン</script>');
        expect(root.querySelector('img,script')).toBeNull();
        root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(root.querySelector('[role=dialog]')).toBeNull();
        expect(document.activeElement.dataset.date).toBe('2026-01-05');
        expect(api.request.mock.calls.every(([, options]) => options === undefined)).toBe(true);
    });

    it('過去月へ年越しで移動し、今月とチャンネルIDをサーバーに指定する', async () => {
        await app.start();
        api.request.mockImplementation(async path => {
            const query = new URLSearchParams(path.split('?')[1]);
            return { ...structuredClone(data), month: { ...data.month,
                year: Number(query.get('year') ?? 2026), month: Number(query.get('month') ?? 1) } };
        });
        root.querySelector('[data-key=previous-month]').click();
        await vi.waitFor(() => expect(root.textContent).toContain('2025年 12月'));
        expect(api.request).toHaveBeenLastCalledWith('/calendar?year=2025&month=12');
        const select = root.querySelector('select'); select.value = 'c'; select.dispatchEvent(new Event('change'));
        await vi.waitFor(() => expect(api.request).toHaveBeenLastCalledWith('/calendar?year=2025&month=12&channelId=c'));
        await app.currentMonth();
        expect(api.request).toHaveBeenLastCalledWith('/calendar?channelId=c');
        expect(root.textContent).toContain('2026年 1月');
    });

    it('月・チャンネル切替後の古い応答と破棄後の応答を表示しない', async () => {
        await app.start();
        let resolve;
        api.request.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
        const old = app.refresh();
        api.request.mockResolvedValueOnce({ ...data, month: { ...data.month, month: 2 }, events: [], relatedEvents: [] });
        await app.changeMonth(1);
        resolve(data); await old;
        expect(root.textContent).toContain('2026年 2月');
        expect(root.textContent).toContain('この月の確定済み予定はありません');
        api.request.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
        const pending = app.selectChannel('c');
        api.request.mockResolvedValueOnce({ ...data, events: [], relatedEvents: [] });
        await app.selectChannel('other');
        resolve(data); await pending;
        expect(root.querySelector('select').value).toBe('other');
        api.request.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
        const destroyed = app.refresh(); app.destroy(); root.replaceChildren(document.createTextNode('別のタブ'));
        resolve(data); await destroyed;
        expect(root.textContent).toBe('別のタブ');
    });

    it('認証・権限を失ったら本文・詳細を消し、失効した選択チャンネルは再取得で解除する', async () => {
        await app.start(); await app.selectChannel('c'); app.selectDate('2026-01-05');
        api.request.mockRejectedValueOnce(Object.assign(new Error('チャンネルを閲覧できません'), { status: 404 }));
        await app.refresh();
        expect(root.querySelector('[role=dialog]')).toBeNull();
        expect(root.querySelector('[data-date]')).toBeNull();
        expect(root.textContent).not.toContain('確定した予定');
        await app.refresh();
        expect(api.request).toHaveBeenLastCalledWith('/calendar?year=2026&month=1');
        app.selectDate('2026-01-05');
        api.request.mockRejectedValueOnce(Object.assign(new Error('退会済み'), { status: 403 }));
        await app.refresh();
        expect(root.querySelector('[role=dialog]')).toBeNull();
        expect(root.querySelector('[data-date]')).toBeNull();
    });

    it('表示中だけ更新し、縮小・非表示・破棄後は定期更新を止める', async () => {
        vi.useFakeTimers();
        await app.start();
        await vi.advanceTimersByTimeAsync(5000);
        expect(api.request).toHaveBeenCalledTimes(2);
        app.setLayoutMode(1);
        expect(root.querySelector('[data-date]')).toBeNull();
        const compact = api.request.mock.calls.length;
        await vi.advanceTimersByTimeAsync(15000);
        expect(api.request).toHaveBeenCalledTimes(compact);
        app.setLayoutMode(0); await vi.advanceTimersByTimeAsync(0);
        vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
        document.dispatchEvent(new Event('visibilitychange'));
        const hidden = api.request.mock.calls.length;
        await vi.advanceTimersByTimeAsync(15000);
        expect(api.request).toHaveBeenCalledTimes(hidden);
        vi.restoreAllMocks();
        document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(0);
        const visible = api.request.mock.calls.length;
        expect(visible).toBeGreaterThan(hidden);
        app.destroy();
        await vi.advanceTimersByTimeAsync(15000);
        expect(api.request).toHaveBeenCalledTimes(visible);
    });
});

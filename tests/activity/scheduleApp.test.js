// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScheduleApp } from '../../activity/src/scheduleApp.js';

describe('month calendar UI', () => {
    let root, api, app;
    const month = { month: { id: 1, year: 2026, month: 9, timezone: 'Asia/Tokyo' }, today: '2026-09-05', memberCount: 2, selfUserId: 'self', slots: [{ id: 2, localDate: '2026-09-05', label: '昼', startMinutes: 840, dayRule: '6', counts: { available: 1, maybe: 0, unavailable: 0, unset: 1 }, selfStatus: 'unset' }] };
    const day = { localDate: '2026-09-05', slots: [{ id: 2, label: '昼', startMinutes: 840, members: [{ userId: 'self', displayName: 'あなた', status: 'unset', isSelf: true }, { userId: 'other', displayName: '<img src=x onerror=alert(1)>', status: 'unregistered', isSelf: false }] }] };
    beforeEach(() => {
        root = document.createElement('div'); document.body.append(root);
        api = { request: vi.fn(async path => {
            if (path.startsWith('/month?')) return structuredClone(month);
            if (path.includes('/days/')) return structuredClone(day);
            if (path === '/range-reset/preview') return { monthId: 1, startDate: '2026-09-05', endDate: '2026-09-06', slotCount: 2, revision: 'revision', slots: [{ id: 2, localDate: '2026-09-05', label: '昼', startMinutes: 840 }] };
            return { status: 'maybe', slotCount: 2 };
        }) };
        app = createScheduleApp(root, { api });
        app.setLayoutMode(0);
    });
    afterEach(() => { app.destroy(); root.remove(); vi.useRealTimers(); });
    it('日曜始まり、全4集計、本人だけ編集、名前のHTMLを実行しない', async () => {
        await app.start();
        expect([...root.querySelectorAll('[role=columnheader]')].map(el => el.textContent)).toEqual(['日','月','火','水','木','金','土']);
        expect(root.querySelectorAll('[data-date]')).toHaveLength(30);
        expect(root.querySelector('[data-date="2026-09-05"]').textContent).toContain('○1');
        expect(root.textContent).not.toContain('14:00');
        await app.selectDate('2026-09-05');
        expect(root.textContent).not.toContain('14:00');
        expect(root.querySelectorAll('[data-status]')).toHaveLength(4);
        expect(root.querySelector('[role=dialog] [role=status]')).not.toBeNull();
        expect(root.textContent).toContain('未登録');
        expect(root.querySelector('img')).toBeNull();
        root.querySelector('[data-status=maybe]').click();
        await vi.waitFor(() => expect(api.request).toHaveBeenCalledWith('/months/1/slots/2', { method: 'PUT', body: { status: 'maybe' } }));
    });
    it('範囲は両端込み、確認前に変更せず、409なら再確認を要求する', async () => {
        await app.start();
        root.querySelector('[data-action=range]').click();
        await app.selectDate('2026-09-06');
        await app.selectDate('2026-09-05');
        expect(api.request).toHaveBeenCalledWith('/range-reset/preview', { method: 'POST', body: { monthId: 1, startDate: '2026-09-05', endDate: '2026-09-06' } });
        expect(api.request.mock.calls.some(([path]) => path === '/range-reset')).toBe(false);
        api.request.mockImplementationOnce(async () => { throw Object.assign(new Error('他の端末で更新されました'), { status: 409 }); });
        root.querySelector('[data-action=confirm-reset]').click();
        await vi.waitFor(() => expect(root.textContent).toContain('再確認'));
        expect(root.querySelector('[data-action=confirm-reset]')).toBeNull();
    });
    it('PIPでは編集操作を隠し、Focused復帰で再取得する', async () => {
        await app.start(); await app.selectDate('2026-09-05');
        app.setLayoutMode(1);
        expect(root.querySelector('[data-status]')).toBeNull();
        expect(root.textContent).toContain('全画面');
        const before = api.request.mock.calls.length;
        app.setLayoutMode(0);
        await vi.waitFor(() => expect(api.request.mock.calls.length).toBeGreaterThan(before));
    });
    it('5秒後に自動更新し、非表示では通信しない', async () => {
        vi.useFakeTimers();
        await app.start();
        const before = api.request.mock.calls.length;
        await vi.advanceTimersByTimeAsync(5000);
        expect(api.request.mock.calls.length).toBeGreaterThan(before);
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
        const paused = api.request.mock.calls.length;
        await vi.advanceTimersByTimeAsync(15000);
        expect(api.request.mock.calls.length).toBe(paused);
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    });
    it('Escapeで詳細を閉じ、日付へフォーカスを戻す', async () => {
        await app.start(); await app.selectDate('2026-09-05');
        root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(root.querySelector('[role=dialog]')).toBeNull();
        expect(document.activeElement.dataset.date).toBe('2026-09-05');
    });
    it('月切替中は旧月の日付を選べない', async () => {
        await app.start();
        let complete;
        api.request.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
        root.querySelector('[data-key=month-1]').click();
        expect(root.querySelector('[data-date="2026-09-05"]').disabled).toBe(true);
        await app.selectDate('2026-09-05');
        complete({ ...month, month: { ...month.month, id: 3, month: 10 }, slots: [] });
        await vi.waitFor(() => expect(root.querySelector('#month-title').textContent).toContain('10月'));
        expect(root.querySelector('[role=dialog]')).toBeNull();
    });
    it('保存中は新規pollを始めず、保存後の取得とフォーカスを確実に更新する', async () => {
        await app.start(); await app.selectDate('2026-09-05');
        let complete;
        api.request.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
        const control = root.querySelector('[data-status=maybe]');
        control.focus(); control.click();
        const pendingCount = api.request.mock.calls.length;
        window.dispatchEvent(new Event('focus'));
        await Promise.resolve();
        expect(api.request.mock.calls.length).toBe(pendingCount);
        expect(document.activeElement.getAttribute('role')).toBe('dialog');
        complete({ status: 'maybe' });
        await vi.waitFor(() => expect(root.textContent).toContain('保存済み'));
        expect(document.activeElement.dataset.key).toBe('status-2-maybe');
    });
    it('月境界の再取得で前月の選択を破棄し、所属を失ったら予定を隠す', async () => {
        await app.start(); await app.selectDate('2026-09-05');
        api.request.mockResolvedValueOnce({ ...month, month: { ...month.month, id: 3, month: 10 }, slots: [] });
        await app.refresh();
        expect(root.querySelector('[role=dialog]')).toBeNull();
        api.request.mockRejectedValueOnce(Object.assign(new Error('現在のメンバーではありません'), { status: 403 }));
        await app.refresh();
        expect(root.querySelector('[role=grid]')).toBeNull();
    });
});

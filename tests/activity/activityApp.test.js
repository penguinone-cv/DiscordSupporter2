// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { createActivityApp } from '../../activity/src/activityApp.js';

it('共通タブは予定入力から始まり、切替で旧画面を停止し縮小時は隠す', async () => {
    const root = document.createElement('div');
    const make = () => ({ start: vi.fn().mockResolvedValue(), destroy: vi.fn(), setLayoutMode: vi.fn() });
    const schedule = make(), candidates = make(), confirmed = make();
    const app = createActivityApp(root, { api: {}, scheduleFactory: () => schedule, candidateFactory: () => candidates, confirmedFactory: () => confirmed });
    app.setLayoutMode(0); await app.start();
    expect(schedule.start).toHaveBeenCalledTimes(1);
    root.querySelector('[data-tab=candidates]').click();
    await vi.waitFor(() => expect(candidates.start).toHaveBeenCalledTimes(1));
    expect(schedule.destroy).toHaveBeenCalledTimes(1);
    root.querySelector('[data-tab=confirmed]').click();
    await vi.waitFor(() => expect(confirmed.start).toHaveBeenCalledTimes(1));
    expect(candidates.destroy).toHaveBeenCalledTimes(1);
    app.setLayoutMode(1);
    expect(root.querySelector('nav').hidden).toBe(true);
    app.destroy(); expect(confirmed.destroy).toHaveBeenCalledTimes(1);
});

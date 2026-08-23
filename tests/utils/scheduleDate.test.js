import { describe, expect, it } from 'vitest';
import { currentDateKey } from '../../src/utils/scheduleDate.js';

describe('scheduleDate', () => {
    it('サーバー時刻をJSTの日付キーへ変換する', () => {
        const beforeJstMidnight = new Date('2026-08-02T14:59:59.999Z');
        const afterJstMidnight = new Date('2026-08-02T15:00:00.000Z');

        expect(currentDateKey(beforeJstMidnight)).toBe('2026-08-02');
        expect(currentDateKey(afterJstMidnight)).toBe('2026-08-03');
    });
});

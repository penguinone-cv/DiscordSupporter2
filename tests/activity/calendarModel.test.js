import { describe, expect, it } from 'vitest';
import { buildMonthGrid, selectedRange, slotLabel, statusLabel } from '../../activity/src/calendarModel.js';

describe('calendar model', () => {
    it('日曜始まり42セル、月内の日付重複なし、閏日を含む', () => {
        const cells = buildMonthGrid(2028, 2, '2028-02-12');
        expect(cells).toHaveLength(42);
        expect(cells[0].date).toBe('2028-01-30');
        const dates = cells.filter(cell => cell.inMonth);
        expect(dates).toHaveLength(29);
        expect(new Set(dates.map(cell => cell.date)).size).toBe(29);
        expect(dates.find(cell => cell.isToday).date).toBe('2028-02-12');
    });
    it('逆順・同日のタップを含む範囲を正規化し、月外を拒否する', () => {
        expect(selectedRange('2026-09-06', '2026-09-04', 2026, 9)).toEqual({ startDate: '2026-09-04', endDate: '2026-09-06' });
        expect(selectedRange('2026-09-06', '2026-09-06', 2026, 9).endDate).toBe('2026-09-06');
        expect(() => selectedRange('2026-09-01', '2026-10-01', 2026, 9)).toThrow();
    });
    it('未登録と未入力を分け、予定枠に固定開始時刻を表示しない', () => {
        expect(statusLabel('unset')).toBe('― 未入力');
        expect(statusLabel('unregistered')).toBe('未登録');
        expect(slotLabel({ label: '夜', startMinutes: 1260 })).toBe('夜');
    });
});

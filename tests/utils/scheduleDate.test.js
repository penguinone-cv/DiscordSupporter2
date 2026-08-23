import { describe, expect, it } from 'vitest';
import {
    currentDateKey,
    dateAtMinutesInTimeZone
} from '../../src/utils/scheduleDate.js';

describe('scheduleDate', () => {
    it('サーバー時刻をJSTの日付キーへ変換する', () => {
        const beforeJstMidnight = new Date('2026-08-02T14:59:59.999Z');
        const afterJstMidnight = new Date('2026-08-02T15:00:00.000Z');

        expect(currentDateKey(beforeJstMidnight)).toBe('2026-08-02');
        expect(currentDateKey(afterJstMidnight)).toBe('2026-08-03');
    });
});

describe('dateAtMinutesInTimeZone', () => {
    it('日本時間の正午を対応するUTCの瞬間へ変換する', () => {
        expect(dateAtMinutesInTimeZone('2026-08-23', 12 * 60, 'Asia/Tokyo').toISOString())
            .toBe('2026-08-23T03:00:00.000Z');
    });

    it('夏時間を含むIANAタイムゾーンを日付ごとに解決する', () => {
        expect(dateAtMinutesInTimeZone('2026-07-01', 12 * 60, 'America/New_York').toISOString())
            .toBe('2026-07-01T16:00:00.000Z');
        expect(dateAtMinutesInTimeZone('2026-01-01', 12 * 60, 'America/New_York').toISOString())
            .toBe('2026-01-01T17:00:00.000Z');
    });

    it('範囲外の時刻を拒否する', () => {
        expect(() => dateAtMinutesInTimeZone('2026-08-23', 1440, 'Asia/Tokyo'))
            .toThrow('不正な時刻です');
    });
});

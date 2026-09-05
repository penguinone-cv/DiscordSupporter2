import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import database from '../../src/repositories/database.js';
import availabilityRepository from '../../src/repositories/availabilityRepository.js';
import scheduleService from '../../src/services/scheduleService.js';

describe('availabilityRepository Activity queries', () => {
    let month;
    let slots;
    let range;

    beforeEach(() => {
        database.close();
        database.initialize(':memory:');
        month = scheduleService.ensureMonth('guild-1', 2026, 9);
        slots = availabilityRepository.listMonthSlots('guild-1', month.id);
        range = { guildId: 'guild-1', userId: 'self', monthId: month.id, startDate: '2026-09-07', endDate: '2026-09-08' };
    });

    afterEach(() => {
        vi.restoreAllMocks();
        database.close();
    });

    function answer(status, source = 'manual', userId = 'self', date = '2026-09-07') {
        availabilityRepository.setUserSlotStatus({
            guildId: 'guild-1', userId, slotId: slots.find(slot => slot.local_date === date).id, status, source
        });
    }

    function basic(status) {
        availabilityRepository.setBasicStatus({
            guildId: 'guild-1', userId: 'self', dayRule: '1',
            templateId: slots.find(slot => slot.local_date === '2026-09-07').template_id, status
        });
    }

    it('全slotと回答を取得して欠損と明示的unset、basic/manualを区別する', () => {
        answer('unset');
        answer('available', 'basic', 'basic-user');
        const rows = availabilityRepository.listMonthResponses('guild-1', month.id);
        expect(rows.filter(row => row.local_date === '2026-09-07')).toEqual([
            expect.objectContaining({ user_id: 'basic-user', status: 'available', source: 'basic' }),
            expect.objectContaining({ user_id: 'self', status: 'unset', source: 'manual' })
        ]);
        expect(rows.find(row => row.local_date === '2026-09-08')).toMatchObject({ user_id: null, status: null, source: null });
        expect(new Set(rows.map(row => row.id)).size).toBe(slots.length);
        expect(availabilityRepository.listMonthResponses('other-guild', month.id)).toEqual([]);
    });

    it('revisionは回答の値、source、欠損、適用基本予定を区別する', () => {
        const revision = () => availabilityRepository.getDateRangeResetPreview(range).revision;
        const missing = revision();
        answer('unset');
        const manualUnset = revision();
        expect(manualUnset).not.toBe(missing);
        answer('unset', 'basic');
        const basicUnset = revision();
        expect(basicUnset).not.toBe(manualUnset);
        answer('available');
        const available = revision();
        expect(available).not.toBe(basicUnset);
        basic('available');
        expect(revision()).not.toBe(available);
    });

    it('他メンバー・範囲外の回答変更はrevisionに影響しない', () => {
        const initial = availabilityRepository.getDateRangeResetPreview(range).revision;
        answer('available', 'manual', 'other');
        answer('maybe', 'manual', 'self', '2026-09-09');
        expect(availabilityRepository.getDateRangeResetPreview(range).revision).toBe(initial);
    });
    it('同値の直接指定を再送しても更新時刻と復元revisionを変えない', () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date('2026-09-05T00:00:00Z'));
            answer('maybe');
            const initial = availabilityRepository.getDateRangeResetPreview(range).revision;
            vi.setSystemTime(new Date('2026-09-05T00:01:00Z'));
            answer('maybe');
            expect(availabilityRepository.getDateRangeResetPreview(range).revision).toBe(initial);
        } finally { vi.useRealTimers(); }
    });

    it('適用基本予定が変わった確認はtransaction内照合で拒否する', () => {
        const preview = availabilityRepository.getDateRangeResetPreview(range);
        basic('available');
        const original = availabilityRepository.getDateRangeResetPreview.bind(availabilityRepository);
        const transactionStates = [];
        vi.spyOn(availabilityRepository, 'getDateRangeResetPreview').mockImplementation(args => {
            transactionStates.push(database.connection().inTransaction);
            return original(args);
        });
        expect(() => availabilityRepository.resetDateRangeToBasic({ ...range, revision: preview.revision }))
            .toThrow(expect.objectContaining({ status: 409, code: 'RESET_CONFLICT' }));
        expect(transactionStates).toEqual([true]);
    });

    it('復元中のDB失敗では範囲内の全回答をロールバックする', () => {
        answer('available');
        answer('maybe', 'manual', 'self', '2026-09-08');
        const lastSlotId = slots.find(slot => slot.local_date === '2026-09-08').id;
        database.connection().exec(`CREATE TRIGGER reject_reset BEFORE INSERT ON user_availability
            WHEN NEW.source = 'basic' AND NEW.slot_id = ${lastSlotId}
            BEGIN SELECT RAISE(ABORT, 'test failure'); END`);
        expect(() => availabilityRepository.resetDateRangeToBasic(range)).toThrow('test failure');
        expect(availabilityRepository.listUserMonthSlots('guild-1', 'self', month.id)
            .filter(slot => slot.local_date >= range.startDate && slot.local_date <= range.endDate)
            .map(slot => [slot.status, slot.source])).toEqual([['available', 'manual'], ['maybe', 'manual']]);
    });

    it('従来のrevisionなし週復元でも基本なしを明示unsetとして保存する', () => {
        answer('available');
        expect(availabilityRepository.resetDateRangeToBasic(range)).toBe(2);
        const resetSlots = availabilityRepository.listUserMonthSlots('guild-1', 'self', month.id)
            .filter(slot => slot.local_date >= range.startDate && slot.local_date <= range.endDate);
        expect(resetSlots.every(slot => slot.status === 'unset' && slot.source === 'basic')).toBe(true);
        basic('available');
        availabilityRepository.materializeBasicForAllUsers('guild-1', month.id);
        expect(availabilityRepository.findUserSlot('guild-1', 'self', resetSlots[0].id).status).toBe('unset');
    });

    it('別ギルドの月IDでは範囲復元も既存回答を書き換えない', () => {
        answer('available');
        expect(availabilityRepository.resetDateRangeToBasic({ ...range, guildId: 'other' })).toBe(0);
        expect(availabilityRepository.findUserSlot('guild-1', 'self', slots.find(slot => slot.local_date === '2026-09-07').id).status)
            .toBe('available');
    });
});

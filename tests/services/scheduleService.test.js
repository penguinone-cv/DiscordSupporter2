import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import database from '../../src/repositories/database.js';
import availabilityRepository from '../../src/repositories/availabilityRepository.js';
import scheduleService from '../../src/services/scheduleService.js';
import { weeksForMonth } from '../../src/utils/scheduleDate.js';

describe('scheduleService', () => {
    beforeEach(() => {
        database.close();
        database.initialize(':memory:');
    });

    afterEach(() => {
        database.close();
    });

    it('平日・土日祝の時間枠を生成し、再実行しても重複しない', () => {
        const month = scheduleService.ensureMonth('guild-1', 2026, 8);
        const first = availabilityRepository.listMonthSlots('guild-1', month.id);

        expect(first).toHaveLength(42);
        expect(first.filter(slot => slot.local_date === '2026-08-10')).toHaveLength(1);
        expect(first.filter(slot => slot.local_date === '2026-08-11')).toEqual([
            expect.objectContaining({ day_rule: 'holiday', label: '昼' }),
            expect.objectContaining({ day_rule: 'holiday', label: '夜' })
        ]);

        scheduleService.ensureMonth('guild-1', 2026, 8);
        expect(availabilityRepository.listMonthSlots('guild-1', month.id)).toHaveLength(42);
    });

    it('基本予定を新しい月へコピーし、作成済み月は後から上書きしない', () => {
        const weekdayNight = availabilityRepository.ensureDefaultTemplates('guild-1')
            .find(template => template.slot_key === 'weekday-night');
        availabilityRepository.setBasicStatus({
            guildId: 'guild-1',
            userId: 'user-1',
            dayRule: '1',
            templateId: weekdayNight.id,
            status: 'available'
        });

        const september = scheduleService.ensureMonth('guild-1', 2026, 9);
        expect(availabilityRepository.listUserMonthSlots('guild-1', 'user-1', september.id)
            .filter(slot => slot.day_rule === '1'))
            .toEqual(expect.arrayContaining([
                expect.objectContaining({ status: 'available', source: 'basic' })
            ]));

        availabilityRepository.setBasicStatus({
            guildId: 'guild-1',
            userId: 'user-1',
            dayRule: '1',
            templateId: weekdayNight.id,
            status: 'unavailable'
        });
        scheduleService.ensureMonth('guild-1', 2026, 9);
        expect(availabilityRepository.listUserMonthSlots('guild-1', 'user-1', september.id)
            .filter(slot => slot.day_rule === '1'))
            .toEqual(expect.arrayContaining([
                expect.objectContaining({ status: 'available', source: 'basic' })
            ]));

        const october = scheduleService.ensureMonth('guild-1', 2026, 10);
        expect(availabilityRepository.listUserMonthSlots('guild-1', 'user-1', october.id)
            .filter(slot => slot.day_rule === '1'))
            .toEqual(expect.arrayContaining([
                expect.objectContaining({ status: 'unavailable', source: 'basic' })
            ]));
    });

    it('月間予定を即時変更し、週単位で基本予定へ戻す', () => {
        const weekdayNight = availabilityRepository.ensureDefaultTemplates('guild-1')
            .find(template => template.slot_key === 'weekday-night');
        availabilityRepository.setBasicStatus({
            guildId: 'guild-1',
            userId: 'user-1',
            dayRule: '1',
            templateId: weekdayNight.id,
            status: 'available'
        });
        const month = scheduleService.ensureMonth('guild-1', 2026, 8);
        const weeks = weeksForMonth(2026, 8);
        const week = weeks.findIndex(dates => dates.includes('2026-08-03'));
        const day = scheduleService.getUserDay(
            'guild-1',
            'user-1',
            month.id,
            week,
            '2026-08-03'
        );

        const changed = scheduleService.cycleMonthStatus({
            guildId: 'guild-1',
            userId: 'user-1',
            monthId: month.id,
            requestedWeek: week,
            localDate: '2026-08-03',
            slotId: day.slots[0].id
        });
        expect(changed.slots[0]).toEqual(expect.objectContaining({
            status: 'maybe',
            source: 'manual'
        }));

        scheduleService.resetWeekToBasic({
            guildId: 'guild-1',
            userId: 'user-1',
            monthId: month.id,
            requestedWeek: week
        });
        expect(scheduleService.getUserDay(
            'guild-1',
            'user-1',
            month.id,
            week,
            '2026-08-03'
        ).slots[0]).toEqual(expect.objectContaining({
            status: 'available',
            source: 'basic'
        }));
    });

    it('月間予定で未入力を明示した日時を基本予定で再上書きしない', () => {
        const weekdayNight = availabilityRepository.ensureDefaultTemplates('guild-1')
            .find(template => template.slot_key === 'weekday-night');
        availabilityRepository.setBasicStatus({
            guildId: 'guild-1',
            userId: 'user-1',
            dayRule: '1',
            templateId: weekdayNight.id,
            status: 'available'
        });
        const month = scheduleService.ensureMonth('guild-1', 2026, 8);
        const week = weeksForMonth(2026, 8)
            .findIndex(dates => dates.includes('2026-08-03'));
        const original = scheduleService.getUserDay(
            'guild-1',
            'user-1',
            month.id,
            week,
            '2026-08-03'
        ).slots[0];

        for (let count = 0; count < 3; count += 1) {
            scheduleService.cycleMonthStatus({
                guildId: 'guild-1',
                userId: 'user-1',
                monthId: month.id,
                requestedWeek: week,
                localDate: '2026-08-03',
                slotId: original.id
            });
        }

        availabilityRepository.materializeBasicForAllUsers('guild-1', month.id);
        expect(scheduleService.getUserDay(
            'guild-1',
            'user-1',
            month.id,
            week,
            '2026-08-03'
        ).slots[0]).toEqual(expect.objectContaining({
            status: 'unset',
            source: 'manual'
        }));
    });

    it('うるう年の2月を週単位に分割する', () => {
        const weeks = weeksForMonth(2028, 2);
        expect(weeks.flat()).toHaveLength(29);
        expect(weeks[0][0]).toBe('2028-02-01');
        expect(weeks.at(-1).at(-1)).toBe('2028-02-29');
    });
});

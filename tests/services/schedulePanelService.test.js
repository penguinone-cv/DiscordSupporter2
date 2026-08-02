import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import database from '../../src/repositories/database.js';
import scheduleService from '../../src/services/scheduleService.js';
import schedulePanelService from '../../src/services/schedulePanelService.js';

function customIds(payload) {
    return payload.components.flatMap(row =>
        row.toJSON().components.map(component => component.custom_id)
    );
}

describe('schedulePanelService', () => {
    const guild = { id: 'guild-1' };

    beforeEach(() => {
        database.close();
        database.initialize(':memory:');
    });

    afterEach(() => {
        database.close();
    });

    it('基本予定を曜日単位のボタンとして表示する', () => {
        const payload = schedulePanelService.buildBasicEditor(guild, 'user-1', 0);
        const ids = customIds(payload);

        expect(payload.embeds[0].toJSON().title).toContain('月曜日');
        expect(ids.some(id => id.startsWith('schedule-user:basic-cycle:0:'))).toBe(true);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('月間予定を週表示し、日付詳細へ移動できる', () => {
        const month = scheduleService.ensureMonth(guild.id, 2026, 8);
        const weekPayload = schedulePanelService.buildMonthWeek(
            guild,
            'user-1',
            month.id,
            0
        );
        const weekJson = weekPayload.components[0].toJSON().components[0];
        const date = weekJson.options[0].value;
        const dayPayload = schedulePanelService.buildMonthDay(
            guild,
            'user-1',
            month.id,
            0,
            date
        );

        expect(weekJson.custom_id).toBe(`schedule-user:month-day-select:${month.id}:0`);
        expect(dayPayload.embeds[0].toJSON().title).toContain('2026年');
        expect(customIds(dayPayload).some(id => id.startsWith('schedule-user:month-cycle:')))
            .toBe(true);
        expect(new Set(customIds(weekPayload)).size).toBe(customIds(weekPayload).length);
        expect(new Set(customIds(dayPayload)).size).toBe(customIds(dayPayload).length);
    });
});

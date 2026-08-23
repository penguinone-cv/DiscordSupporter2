import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import database from '../../src/repositories/database.js';
import gameCandidateService from '../../src/services/gameCandidateService.js';
import scheduleService from '../../src/services/scheduleService.js';
import schedulePanelService, {
    isFutureCandidate
} from '../../src/services/schedulePanelService.js';

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
        vi.useRealTimers();
        vi.restoreAllMocks();
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

    it('候補日時に○、△、×の人数を個別表示する', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-01T00:00:00.000Z'));
        vi.spyOn(gameCandidateService, 'aggregate').mockResolvedValue({
            month: {
                id: 1,
                guild_id: guild.id,
                year: 2026,
                month: 8,
                timezone: 'Asia/Tokyo'
            },
            game: { id: 1, display_name: 'apex' },
            candidates: [{
                slotId: 1,
                localDate: '2026-08-03',
                startMinutes: 21 * 60,
                availableCount: 1,
                maybeCount: 2,
                unavailableCount: 3,
                includingMaybeCount: 3
            }]
        });

        const payload = await schedulePanelService.buildCandidateResults(guild, 1, 1);
        const description = payload.embeds[0].toJSON().description;

        expect(description).toContain('○ 1人 / △ 2人 / × 3人');
        expect(description).not.toContain('△込み');
        const selectDescription = payload.components[0].toJSON().components[0]
            .options[0].description;
        expect(selectDescription).toBe('○ 1人 / △ 2人 / × 3人');
    });

    it('候補開始日時が未来かを月のタイムゾーンで判定する', () => {
        const now = new Date('2026-08-23T15:30:00.000Z');
        const candidate = { localDate: '2026-08-24', startMinutes: 0 };

        expect(isFutureCandidate(candidate, 'Asia/Tokyo', now)).toBe(false);
        expect(isFutureCandidate(candidate, 'UTC', now)).toBe(true);
    });

    it('未来の上位候補を選択し、選択済みslot ID付きの募集ボタンを表示する', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-23T15:30:00.000Z'));
        vi.spyOn(gameCandidateService, 'aggregate').mockResolvedValue({
            month: {
                id: 3,
                guild_id: guild.id,
                year: 2026,
                month: 8,
                timezone: 'Asia/Tokyo'
            },
            game: { id: 42, display_name: 'テストゲーム' },
            candidates: [
                {
                    slotId: 10,
                    localDate: '2026-08-24',
                    startMinutes: 0,
                    availableCount: 5,
                    maybeCount: 1,
                    unavailableCount: 0,
                    includingMaybeCount: 6
                },
                {
                    slotId: 11,
                    localDate: '2026-08-24',
                    startMinutes: 31,
                    availableCount: 4,
                    maybeCount: 1,
                    unavailableCount: 2,
                    includingMaybeCount: 5
                },
                {
                    slotId: 12,
                    localDate: '2026-08-25',
                    startMinutes: 21 * 60,
                    availableCount: 3,
                    maybeCount: 0,
                    unavailableCount: 1,
                    includingMaybeCount: 3
                }
            ]
        });

        const initial = await schedulePanelService.buildCandidateResults(guild, 3, 42, 1);
        const initialJson = initial.components.map(row => row.toJSON());

        expect(initialJson[0].components[0].custom_id)
            .toBe('schedule-user:candidate-slot-select:3:42:1');
        expect(initialJson[0].components[0].options.map(option => option.value))
            .toEqual(['11', '12']);
        expect(initialJson[1].components[0]).toMatchObject({
            custom_id: 'schedule-user:candidate-recruit:3:42:1:none',
            disabled: true
        });

        const selected = await schedulePanelService.buildCandidateResults(
            guild,
            3,
            42,
            1,
            11
        );
        const selectedJson = selected.components.map(row => row.toJSON());

        expect(selectedJson[0].components[0].options[0].default).toBe(true);
        expect(selectedJson[1].components[0]).toMatchObject({
            custom_id: 'schedule-user:candidate-recruit:3:42:1:11',
            disabled: false
        });
    });
});

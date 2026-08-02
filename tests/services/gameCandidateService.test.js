import { Collection } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import database from '../../src/repositories/database.js';
import gameRepository from '../../src/repositories/gameRepository.js';
import gameInterestRepository from '../../src/repositories/gameInterestRepository.js';
import availabilityRepository from '../../src/repositories/availabilityRepository.js';
import scheduleService from '../../src/services/scheduleService.js';
import gameCandidateService from '../../src/services/gameCandidateService.js';

describe('gameCandidateService', () => {
    beforeEach(() => {
        database.close();
        database.initialize(':memory:');
    });

    afterEach(() => {
        database.close();
    });

    it('ゲーム希望者の○と△を集計し、退会者とBotを除外する', async () => {
        const game = gameRepository.registerChannel({
            guildId: 'guild-1',
            channelId: 'channel-1',
            channelName: 'apex',
            parentCategoryId: 'category-1'
        });
        const month = scheduleService.ensureMonth('guild-1', 2026, 8);
        const slot = availabilityRepository.listMonthSlots('guild-1', month.id)[0];
        const users = [
            ['user-1', 'available'],
            ['user-2', 'maybe'],
            ['departed-user', 'available'],
            ['bot-user', 'available']
        ];
        for (const [userId, status] of users) {
            gameInterestRepository.replacePreferencesForGames({
                guildId: 'guild-1',
                userId,
                gameIds: [game.id],
                preferredGameIds: [game.id]
            });
            availabilityRepository.setUserSlotStatus({
                guildId: 'guild-1',
                userId,
                slotId: slot.id,
                status
            });
        }
        availabilityRepository.setUserSlotStatus({
            guildId: 'guild-1',
            userId: 'not-interested',
            slotId: slot.id,
            status: 'available'
        });

        const members = new Collection([
            ['user-1', { id: 'user-1', user: { id: 'user-1', bot: false } }],
            ['user-2', { id: 'user-2', user: { id: 'user-2', bot: false } }],
            ['bot-user', { id: 'bot-user', user: { id: 'bot-user', bot: true } }],
            ['not-interested', {
                id: 'not-interested',
                user: { id: 'not-interested', bot: false }
            }]
        ]);
        const guild = {
            id: 'guild-1',
            members: { fetch: vi.fn().mockResolvedValue(members) }
        };

        const result = await gameCandidateService.aggregate(guild, month.id, game.id);

        expect(result.candidates).toEqual([
            expect.objectContaining({
                slotId: slot.id,
                availableCount: 1,
                maybeCount: 1,
                includingMaybeCount: 2
            })
        ]);
    });

    it('休止中ゲームは候補日時を集計しない', async () => {
        const game = gameRepository.registerChannel({
            guildId: 'guild-1',
            channelId: 'channel-1',
            channelName: 'apex',
            parentCategoryId: 'category-1'
        });
        const month = scheduleService.ensureMonth('guild-1', 2026, 8);
        gameRepository.setArchived(game.id);

        await expect(gameCandidateService.aggregate({ id: 'guild-1' }, month.id, game.id))
            .rejects.toThrow('対象の稼働中ゲームが見つかりません');
    });

    it('月間画面を開いていなくても、後から登録した基本予定を集計する', async () => {
        const game = gameRepository.registerChannel({
            guildId: 'guild-1',
            channelId: 'channel-1',
            channelName: 'apex',
            parentCategoryId: 'category-1'
        });
        const month = scheduleService.ensureMonth('guild-1', 2026, 8);
        const mondaySlot = availabilityRepository.listMonthSlots('guild-1', month.id)
            .find(slot => slot.local_date === '2026-08-03');
        gameInterestRepository.replacePreferencesForGames({
            guildId: 'guild-1',
            userId: 'user-1',
            gameIds: [game.id],
            preferredGameIds: [game.id]
        });
        availabilityRepository.setBasicStatus({
            guildId: 'guild-1',
            userId: 'user-1',
            dayRule: mondaySlot.day_rule,
            templateId: mondaySlot.template_id,
            status: 'available'
        });
        const members = new Collection([
            ['user-1', { id: 'user-1', user: { id: 'user-1', bot: false } }]
        ]);

        const result = await gameCandidateService.aggregate({
            id: 'guild-1',
            members: { fetch: vi.fn().mockResolvedValue(members) }
        }, month.id, game.id);

        expect(result.candidates).toEqual(expect.arrayContaining([
            expect.objectContaining({
                slotId: mondaySlot.id,
                availableCount: 1,
                includingMaybeCount: 1
            })
        ]));
    });
});

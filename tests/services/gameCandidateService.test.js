import { Collection } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import database from '../../src/repositories/database.js';
import gameRepository from '../../src/repositories/gameRepository.js';
import gameInterestRepository from '../../src/repositories/gameInterestRepository.js';
import availabilityRepository from '../../src/repositories/availabilityRepository.js';
import scheduleService from '../../src/services/scheduleService.js';
import gameCandidateService from '../../src/services/gameCandidateService.js';

const START_OF_AUGUST_IN_JST = new Date('2026-07-31T15:00:00.000Z');

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
            ['user-3', 'unavailable'],
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
            ['user-3', { id: 'user-3', user: { id: 'user-3', bot: false } }],
            ['bot-user', { id: 'bot-user', user: { id: 'bot-user', bot: true } }],
            ['not-interested', {
                id: 'not-interested',
                user: { id: 'not-interested', bot: false }
            }]
        ]);
        const guild = {
            id: 'guild-1',
            memberCount: members.size,
            members: {
                cache: members,
                fetch: vi.fn()
            }
        };

        const result = await gameCandidateService.aggregate(
            guild,
            month.id,
            game.id,
            START_OF_AUGUST_IN_JST
        );

        expect(guild.members.fetch).not.toHaveBeenCalled();
        expect(result.candidates).toEqual([
            expect.objectContaining({
                slotId: slot.id,
                availableCount: 1,
                maybeCount: 1,
                unavailableCount: 1,
                includingMaybeCount: 2
            })
        ]);
    });

    it('再起動直後の不完全なメンバーキャッシュを補完して全員を集計する', async () => {
        const game = gameRepository.registerChannel({
            guildId: 'guild-1',
            channelId: 'channel-1',
            channelName: 'apex',
            parentCategoryId: 'category-1'
        });
        const month = scheduleService.ensureMonth('guild-1', 2026, 8);
        const slot = availabilityRepository.listMonthSlots('guild-1', month.id)[0];
        for (const userId of ['user-1', 'user-2']) {
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
                status: 'available'
            });
        }

        const cachedMembers = new Collection([
            ['user-1', { id: 'user-1', user: { id: 'user-1', bot: false } }]
        ]);
        const allMembers = new Collection([
            ...cachedMembers,
            ['user-2', { id: 'user-2', user: { id: 'user-2', bot: false } }]
        ]);
        const guild = {
            id: 'guild-1',
            memberCount: allMembers.size,
            members: {
                cache: cachedMembers,
                fetch: vi.fn().mockResolvedValue(allMembers)
            }
        };

        const result = await gameCandidateService.aggregate(
            guild,
            month.id,
            game.id,
            START_OF_AUGUST_IN_JST
        );

        expect(guild.members.fetch).toHaveBeenCalledOnce();
        expect(result.candidates).toEqual([
            expect.objectContaining({
                slotId: slot.id,
                availableCount: 2,
                includingMaybeCount: 2
            })
        ]);
    });

    it('メンバーキャッシュの補完に失敗したときは不完全な集計を返さない', async () => {
        const game = gameRepository.registerChannel({
            guildId: 'guild-1',
            channelId: 'channel-1',
            channelName: 'apex',
            parentCategoryId: 'category-1'
        });
        const month = scheduleService.ensureMonth('guild-1', 2026, 8);
        const guild = {
            id: 'guild-1',
            memberCount: 2,
            members: {
                cache: new Collection(),
                fetch: vi.fn().mockRejectedValue(new Error('member fetch failed'))
            }
        };

        await expect(gameCandidateService.aggregate(
            guild,
            month.id,
            game.id,
            START_OF_AUGUST_IN_JST
        ))
            .rejects.toThrow('member fetch failed');
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

        await expect(gameCandidateService.aggregate(
            { id: 'guild-1' },
            month.id,
            game.id,
            START_OF_AUGUST_IN_JST
        ))
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
            memberCount: members.size,
            members: { cache: members, fetch: vi.fn() }
        }, month.id, game.id, START_OF_AUGUST_IN_JST);

        expect(result.candidates).toEqual(expect.arrayContaining([
            expect.objectContaining({
                slotId: mondaySlot.id,
                availableCount: 1,
                includingMaybeCount: 1
            })
        ]));
    });

    it('JSTの当日以降だけを○人数に関係なく日付順で返す', async () => {
        const game = gameRepository.registerChannel({
            guildId: 'guild-1',
            channelId: 'channel-1',
            channelName: 'apex',
            parentCategoryId: 'category-1'
        });
        const month = scheduleService.ensureMonth('guild-1', 2026, 8);
        const slots = availabilityRepository.listMonthSlots('guild-1', month.id);
        const pastSlot = slots.find(slot => slot.local_date === '2026-08-02');
        const todaySlot = slots.find(slot => slot.local_date === '2026-08-03');
        const futureSlot = slots.find(slot => slot.local_date === '2026-08-04');

        for (const userId of ['user-1', 'user-2', 'user-3']) {
            gameInterestRepository.replacePreferencesForGames({
                guildId: 'guild-1',
                userId,
                gameIds: [game.id],
                preferredGameIds: [game.id]
            });
        }
        for (const [userId, slot, status] of [
            ['user-1', pastSlot, 'available'],
            ['user-1', todaySlot, 'available'],
            ['user-2', todaySlot, 'maybe'],
            ['user-3', todaySlot, 'unavailable'],
            ['user-1', futureSlot, 'available'],
            ['user-2', futureSlot, 'available'],
            ['user-3', futureSlot, 'available']
        ]) {
            availabilityRepository.setUserSlotStatus({
                guildId: 'guild-1',
                userId,
                slotId: slot.id,
                status
            });
        }
        const members = new Collection(['user-1', 'user-2', 'user-3'].map(userId => [
            userId,
            { id: userId, user: { id: userId, bot: false } }
        ]));

        const result = await gameCandidateService.aggregate({
            id: 'guild-1',
            memberCount: members.size,
            members: { cache: members, fetch: vi.fn() }
        }, month.id, game.id, new Date('2026-08-02T15:30:00.000Z'));

        expect(result.candidates.map(candidate => candidate.localDate)).toEqual([
            '2026-08-03',
            '2026-08-04'
        ]);
        expect(result.candidates[0]).toEqual(expect.objectContaining({
            availableCount: 1,
            maybeCount: 1,
            unavailableCount: 1
        }));
        expect(result.candidates[1]).toEqual(expect.objectContaining({
            availableCount: 3,
            maybeCount: 0,
            unavailableCount: 0
        }));
    });
});

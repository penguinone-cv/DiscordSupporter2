import { Collection } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import database from '../../src/repositories/database.js';
import gameRepository from '../../src/repositories/gameRepository.js';
import activityRepository from '../../src/repositories/activityRepository.js';
import guildSettingsRepository from '../../src/repositories/guildSettingsRepository.js';
import channelActivityService from '../../src/services/channelActivityService.js';

describe('channelActivityService', () => {
    beforeEach(() => {
        database.close();
        database.initialize(':memory:');
        guildSettingsRepository.upsert({
            guildId: 'guild-1',
            gameCategoryId: 'category-1',
            dormantAfterDays: 90
        });
        gameRepository.registerChannel({
            guildId: 'guild-1',
            channelId: 'channel-1',
            channelName: 'apex',
            parentCategoryId: 'category-1',
            activeFrom: '2025-01-01T00:00:00.000Z'
        });
    });

    afterEach(() => {
        database.close();
    });

    it('Bot投稿は全投稿日時だけを更新し、人間の活動にはしない', () => {
        channelActivityService.recordMessage({
            guild: { id: 'guild-1' },
            channel: { id: 'channel-1', isThread: () => false },
            author: { id: 'bot-1', bot: true },
            webhookId: null,
            createdAt: new Date('2026-01-01T00:00:00.000Z')
        });

        const activity = activityRepository.findByChannelId('channel-1');
        expect(activity.last_any_message_at).toBe('2026-01-01T00:00:00.000Z');
        expect(activity.last_user_message_at).toBeNull();
        expect(activity.reconciliation_status).toBe('unknown');
    });

    it('ゲームチャンネル配下のスレッド投稿を親ゲームの活動として記録する', () => {
        channelActivityService.recordMessage({
            guild: { id: 'guild-1' },
            channel: { id: 'thread-1', parentId: 'channel-1', isThread: () => true },
            author: { id: 'user-1', bot: false },
            webhookId: null,
            createdAt: new Date('2026-07-01T12:00:00.000Z')
        });

        const activity = activityRepository.findByChannelId('channel-1');
        expect(activity.last_user_message_at).toBe('2026-07-01T12:00:00.000Z');
        expect(activity.last_user_id).toBe('user-1');
        expect(activity.reconciliation_status).toBe('confirmed');
    });

    it('期限より古いBot投稿まで走査した場合は人間投稿なしを確定できる', async () => {
        const messages = new Collection([
            ['bot-message', {
                id: 'bot-message',
                author: { bot: true },
                webhookId: null,
                createdAt: new Date('2025-01-01T00:00:00.000Z')
            }]
        ]);
        const channel = {
            id: 'channel-1',
            guild: { id: 'guild-1' },
            messages: { fetch: vi.fn().mockResolvedValue(messages) }
        };

        const result = await channelActivityService.reconcileChannel(channel, {
            cutoff: new Date('2026-01-01T00:00:00.000Z')
        });

        expect(result.reconciliation_status).toBe('confirmed');
        expect(channelActivityService.listDormantCandidates(
            'guild-1', new Date('2026-08-01T00:00:00.000Z')
        )).toHaveLength(1);
    });
});

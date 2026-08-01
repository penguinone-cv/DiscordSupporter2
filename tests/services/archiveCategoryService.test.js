import { ChannelType, Collection } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import database from '../../src/repositories/database.js';
import archiveRepository from '../../src/repositories/archiveRepository.js';
import guildSettingsRepository from '../../src/repositories/guildSettingsRepository.js';
import archiveCategoryService from '../../src/services/archiveCategoryService.js';

describe('archiveCategoryService', () => {
    beforeEach(() => {
        database.close();
        database.initialize(':memory:');
    });

    afterEach(() => {
        database.close();
    });

    it('既存カテゴリが50件で満杯なら次の休止中カテゴリを作成する', async () => {
        const channels = new Collection();
        const fullCategory = {
            id: 'archive-1',
            name: '休止中ゲーム',
            type: ChannelType.GuildCategory,
            parentId: null,
            permissionOverwrites: { set: vi.fn() }
        };
        channels.set(fullCategory.id, fullCategory);
        for (let index = 0; index < 50; index++) {
            channels.set(`child-${index}`, { id: `child-${index}`, parentId: fullCategory.id });
        }
        const created = {
            id: 'archive-2',
            name: '休止中ゲーム-2',
            type: ChannelType.GuildCategory,
            parentId: null
        };
        const guild = {
            id: 'guild-1',
            roles: { everyone: { id: 'guild-1' } },
            members: { me: { id: 'bot-member' } },
            channels: {
                cache: channels,
                create: vi.fn().mockResolvedValue(created)
            }
        };
        guildSettingsRepository.upsert({
            guildId: guild.id,
            gameCategoryId: 'active-category'
        });
        archiveRepository.registerCategory(guild.id, fullCategory.id, 1);

        const result = await archiveCategoryService.getOrCreate(guild);

        expect(result.id).toBe(created.id);
        expect(guild.channels.create).toHaveBeenCalledWith(
            expect.objectContaining({ name: '休止中ゲーム-2' })
        );
        expect(archiveRepository.listCategories(guild.id).map(row => row.category_id))
            .toEqual(['archive-1', 'archive-2']);
    });
});

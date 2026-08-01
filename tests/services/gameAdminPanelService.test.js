import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import database from '../../src/repositories/database.js';
import gameRepository from '../../src/repositories/gameRepository.js';
import activityRepository from '../../src/repositories/activityRepository.js';
import guildSettingsRepository from '../../src/repositories/guildSettingsRepository.js';
import gameAdminPanelService from '../../src/services/gameAdminPanelService.js';

function getCustomIds(payload) {
    return payload.components.flatMap(row =>
        row.toJSON().components.map(component => component.custom_id)
    );
}

describe('gameAdminPanelService', () => {
    const guild = { id: 'guild-1' };

    beforeEach(() => {
        database.close();
        database.initialize(':memory:');
        guildSettingsRepository.upsert({
            guildId: guild.id,
            gameCategoryId: 'category-1',
            dormantAfterDays: 90
        });
    });

    afterEach(() => {
        database.close();
    });

    it('uses unique custom IDs for both disabled pagination buttons on a one-page dormant list', () => {
        gameRepository.registerChannel({
            guildId: guild.id,
            channelId: 'channel-1',
            channelName: 'game-1',
            parentCategoryId: 'category-1',
            activeFrom: '2000-01-01T00:00:00.000Z'
        });
        activityRepository.markReconciled('channel-1', {
            lastUserMessageAt: null,
            lastUserId: null,
            confirmed: true
        });

        const payload = gameAdminPanelService.buildList(guild, 'dormant', 0);
        const customIds = getCustomIds(payload);
        const navigation = payload.components[1].toJSON().components;

        expect(new Set(customIds).size).toBe(customIds.length);
        expect(navigation.map(button => button.custom_id)).toEqual([
            'game:list:dormant:-1',
            'game:list:dormant:1'
        ]);
        expect(navigation.every(button => button.disabled)).toBe(true);
    });

    it('keeps pagination targets unique on the first and last pages', () => {
        for (let index = 0; index < 26; index++) {
            gameRepository.registerChannel({
                guildId: guild.id,
                channelId: `channel-${index}`,
                channelName: `game-${String(index).padStart(2, '0')}`,
                parentCategoryId: 'category-1'
            });
        }

        const firstPage = gameAdminPanelService.buildList(guild, 'all', 0);
        const lastPage = gameAdminPanelService.buildList(guild, 'all', 1);

        for (const payload of [firstPage, lastPage]) {
            const customIds = getCustomIds(payload);
            expect(new Set(customIds).size).toBe(customIds.length);
        }
        expect(firstPage.components[1].toJSON().components.map(button => button.custom_id))
            .toEqual(['game:list:all:-1', 'game:list:all:1']);
        expect(lastPage.components[1].toJSON().components.map(button => button.custom_id))
            .toEqual(['game:list:all:0', 'game:list:all:2']);
    });
});

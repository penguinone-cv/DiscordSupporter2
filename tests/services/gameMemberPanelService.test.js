import { Collection } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import database from '../../src/repositories/database.js';
import gameRepository from '../../src/repositories/gameRepository.js';
import archiveRepository from '../../src/repositories/archiveRepository.js';
import gameInterestRepository from '../../src/repositories/gameInterestRepository.js';
import guildSettingsRepository from '../../src/repositories/guildSettingsRepository.js';
import gameMemberPanelService from '../../src/services/gameMemberPanelService.js';

function customIds(payload) {
    return payload.components.flatMap(row =>
        row.toJSON().components.map(component => component.custom_id)
    );
}

describe('gameMemberPanelService', () => {
    const guild = { id: 'guild-1' };

    beforeEach(() => {
        database.close();
        database.initialize(':memory:');
    });

    afterEach(() => {
        database.close();
    });

    function prepareArchivedGame() {
        const game = gameRepository.registerChannel({
            guildId: guild.id,
            channelId: 'channel-1',
            channelName: 'apex',
            parentCategoryId: 'category-1'
        });
        const operation = archiveRepository.beginOperation({
            gameId: game.id,
            type: 'archive',
            userId: 'admin-1',
            snapshot: { channelId: 'channel-1', data: { name: 'apex' } }
        });
        archiveRepository.updateOperation(operation.id, {
            status: 'succeeded',
            phase: 'completed'
        });
        gameRepository.setArchived(game.id);
        return { game, snapshotId: operation.snapshot_id };
    }

    it('1ページだけでも全コンポーネントのcustom IDが重複しない', () => {
        prepareArchivedGame();

        const payload = gameMemberPanelService.buildArchivedList(guild, 0);
        const ids = customIds(payload);
        const navigation = payload.components[1].toJSON().components;

        expect(new Set(ids).size).toBe(ids.length);
        expect(navigation.map(button => button.custom_id)).toEqual([
            'game-user:archived:-1',
            'game-user:archived:1'
        ]);
        expect(navigation.every(button => button.disabled)).toBe(true);
    });

    it('本人の復帰希望状態と人数を詳細へ反映する', () => {
        const { game, snapshotId } = prepareArchivedGame();
        gameInterestRepository.toggleRestoreRequest({
            guildId: guild.id,
            gameId: game.id,
            snapshotId,
            userId: 'user-1'
        });

        const payload = gameMemberPanelService.buildGameDetail(
            guild,
            'user-1',
            game.id,
            0
        );
        const json = payload.embeds[0].toJSON();
        const button = payload.components[0].toJSON().components[0];

        expect(json.description).toContain('現在の復帰希望：**1人**');
        expect(json.description).toContain('あなたの希望：**登録済み**');
        expect(button.label).toBe('復帰希望を取り消す');
    });

    it('設定されたチャンネルへ一般ユーザー用パネルを設置する', async () => {
        guildSettingsRepository.upsert({
            guildId: guild.id,
            gameCategoryId: 'category-1',
            adminChannelId: 'admin-1'
        });
        guildSettingsRepository.setMemberPanelSettings(guild.id, {
            channelId: 'member-panel-1',
            restoreRequestThreshold: 5
        });
        const sentMessage = { id: 'message-1', url: 'https://discord.test/message-1' };
        const channel = {
            id: 'member-panel-1',
            name: 'game-panel',
            isSendable: () => true,
            messages: { fetch: vi.fn().mockResolvedValue(null) },
            send: vi.fn().mockResolvedValue(sentMessage)
        };
        const discordGuild = {
            ...guild,
            name: 'Test Guild',
            channels: {
                cache: new Collection([[channel.id, channel]]),
                fetch: vi.fn().mockResolvedValue(channel)
            }
        };

        const result = await gameMemberPanelService.ensurePanel(discordGuild);

        expect(result).toBe(sentMessage);
        expect(channel.send).toHaveBeenCalledWith(expect.objectContaining({
            embeds: expect.any(Array),
            components: expect.any(Array)
        }));
        expect(guildSettingsRepository.find(guild.id).member_panel_message_id)
            .toBe(sentMessage.id);
    });
});

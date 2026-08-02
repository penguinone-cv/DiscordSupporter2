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

    function prepareActiveGame({ channelId = 'channel-active', name = 'apex' } = {}) {
        return gameRepository.registerChannel({
            guildId: guild.id,
            channelId,
            channelName: name,
            parentCategoryId: 'category-1'
        });
    }

    function prepareArchivedGame() {
        const game = prepareActiveGame({ channelId: 'channel-1' });
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

    it('公開パネルに希望編集と休止中ゲームの入口を表示する', () => {
        const payload = gameMemberPanelService.buildMainPanel();
        const scheduleButtons = payload.components[0].toJSON().components;
        const gameButtons = payload.components[1].toJSON().components;

        expect(scheduleButtons.map(button => button.custom_id)).toEqual([
            'schedule-user:month-open:0:0',
            'schedule-user:basic:0',
            'schedule-user:candidate-open:0:0'
        ]);
        expect(gameButtons.map(button => button.custom_id)).toEqual([
            'game-user:preferences:0',
            'game-user:archived:0'
        ]);
    });

    it('稼働中ゲームを複数選択でき、現在の希望を初期選択へ反映する', () => {
        const first = prepareActiveGame({ channelId: 'channel-1', name: 'apex' });
        const second = prepareActiveGame({ channelId: 'channel-2', name: 'minecraft' });
        gameInterestRepository.replacePreferencesForGames({
            guildId: guild.id,
            userId: 'user-1',
            gameIds: [first.id, second.id],
            preferredGameIds: [second.id]
        });

        const payload = gameMemberPanelService.buildPreferenceEditor(guild, 'user-1', 0);
        const select = payload.components[0].toJSON().components[0];
        const navigation = payload.components[1].toJSON().components;

        expect(select.custom_id).toBe('game-user:preferences-save:0');
        expect(select.min_values).toBe(0);
        expect(select.max_values).toBe(2);
        expect(select.options).toEqual([
            expect.objectContaining({ label: 'apex', value: String(first.id), default: false }),
            expect.objectContaining({ label: 'minecraft', value: String(second.id), default: true })
        ]);
        expect(navigation.map(button => button.custom_id)).toEqual([
            'game-user:preferences:-1',
            'game-user:preferences:1',
            'game-user:home'
        ]);
        expect(navigation.slice(0, 2).every(button => button.disabled)).toBe(true);
    });

    it('表示ページの選択だけを保存する', () => {
        const first = prepareActiveGame({ channelId: 'channel-1', name: 'apex' });
        const second = prepareActiveGame({ channelId: 'channel-2', name: 'minecraft' });

        const payload = gameMemberPanelService.updatePreferencePage(
            guild,
            'user-1',
            0,
            [String(second.id)]
        );
        const games = gameInterestRepository.listActivePreferenceGames(guild.id, 'user-1');

        expect(games).toEqual([
            expect.objectContaining({ id: first.id, preferred: 0 }),
            expect.objectContaining({ id: second.id, preferred: 1 })
        ]);
        expect(payload.embeds[0].toJSON().description).toContain('現在の選択：**1件**');

        gameMemberPanelService.updatePreferencePage(guild, 'user-1', 0, []);
        expect(gameInterestRepository.listActivePreferenceGames(guild.id, 'user-1'))
            .toEqual([
                expect.objectContaining({ id: first.id, preferred: 0 }),
                expect.objectContaining({ id: second.id, preferred: 0 })
            ]);
    });

    it('26件以上のゲームを25件ずつページ分割する', () => {
        for (let index = 0; index < 26; index += 1) {
            prepareActiveGame({
                channelId: `channel-${index}`,
                name: `game-${String(index).padStart(2, '0')}`
            });
        }

        const firstPage = gameMemberPanelService.buildPreferenceEditor(guild, 'user-1', 0);
        const secondPage = gameMemberPanelService.buildPreferenceEditor(guild, 'user-1', 1);
        const firstSelect = firstPage.components[0].toJSON().components[0];
        const secondSelect = secondPage.components[0].toJSON().components[0];
        const secondNavigation = secondPage.components[1].toJSON().components;

        expect(firstSelect.options).toHaveLength(25);
        expect(firstSelect.max_values).toBe(25);
        expect(secondSelect.options).toHaveLength(1);
        expect(secondSelect.max_values).toBe(1);
        expect(secondNavigation[0].disabled).toBe(false);
        expect(secondNavigation[1].disabled).toBe(true);
    });

    it('表示ページにないゲームIDは保存しない', () => {
        prepareActiveGame({ channelId: 'channel-1', name: 'apex' });

        expect(() => gameMemberPanelService.updatePreferencePage(
            guild,
            'user-1',
            0,
            ['999']
        )).toThrow('編集対象外のゲームは選択できません');
    });

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

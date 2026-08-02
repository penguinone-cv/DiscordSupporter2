import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    StringSelectMenuBuilder
} from 'discord.js';
import guildSettingsRepository from '../repositories/guildSettingsRepository.js';
import gameInterestRepository from '../repositories/gameInterestRepository.js';
import logger from '../utils/logger.js';

const PAGE_SIZE = 25;

class GameMemberPanelService {
    buildMainPanel() {
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('🎮 ゲーム案内')
            .setDescription([
                '遊びたいゲームを自分用の希望リストへ登録できます。',
                '休止中ゲームへの復帰希望を登録できます。',
                '操作内容と希望者の名前は他のメンバーには表示されません。'
            ].join('\n'));
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('game-user:preferences:0')
                .setLabel('遊びたいゲームを編集')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('game-user:archived:0')
                .setLabel('休止中ゲームを見る')
                .setStyle(ButtonStyle.Secondary)
        );
        return { embeds: [embed], components: [row] };
    }

    async ensurePanel(guild) {
        const settings = guildSettingsRepository.find(guild.id);
        if (!settings?.member_panel_channel_id) return null;
        const channel = guild.channels.cache.get(settings.member_panel_channel_id)
            ?? await guild.channels.fetch(settings.member_panel_channel_id).catch(() => null);
        if (!channel?.isSendable?.()) throw new Error('一般ユーザー用パネルのチャンネルへ投稿できません');

        const payload = this.buildMainPanel();
        let message = null;
        if (settings.member_panel_message_id) {
            message = await channel.messages.fetch(settings.member_panel_message_id).catch(() => null);
        }
        if (message) {
            await message.edit(payload);
            return message;
        }

        message = await channel.send(payload);
        guildSettingsRepository.setMemberPanelMessage(guild.id, message.id);
        logger.info(`一般ユーザー用ゲームパネルを設置しました: ${guild.name}/${channel.name}`);
        return message;
    }

    async refreshPanel(guild) {
        try {
            return await this.ensurePanel(guild);
        } catch (error) {
            logger.warn(`一般ユーザー用ゲームパネルを更新できませんでした (${guild.name}): ${error.message}`);
            return null;
        }
    }

    buildPreferenceEditor(guild, userId, requestedPage = 0) {
        const games = gameInterestRepository.listActivePreferenceGames(guild.id, userId);
        const pages = Math.max(1, Math.ceil(games.length / PAGE_SIZE));
        const page = Math.max(0, Math.min(requestedPage, pages - 1));
        const pageGames = games.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
        const preferredCount = games.filter(game => game.preferred).length;
        const embed = new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle(`🎯 遊びたいゲーム ${page + 1}/${pages}`)
            .setDescription(pageGames.length
                ? [
                    '遊びたいゲームを複数選択してください。変更すると自動で保存されます。',
                    `現在の選択：**${preferredCount}件**`,
                    '',
                    '休止中のゲームは一覧から外れますが、以前の希望は保持されます。'
                ].join('\n')
                : '現在、希望を登録できる稼働中ゲームはありません。');

        const components = [];
        if (pageGames.length) {
            const select = new StringSelectMenuBuilder()
                .setCustomId(`game-user:preferences-save:${page}`)
                .setPlaceholder('遊びたいゲームを選択')
                .setMinValues(0)
                .setMaxValues(pageGames.length)
                .addOptions(pageGames.map(game => ({
                    label: game.display_name.slice(0, 100),
                    value: String(game.id),
                    default: Boolean(game.preferred)
                })));
            components.push(new ActionRowBuilder().addComponents(select));
        }

        components.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`game-user:preferences:${page - 1}`)
                .setLabel('前へ')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0),
            new ButtonBuilder()
                .setCustomId(`game-user:preferences:${page + 1}`)
                .setLabel('次へ')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page >= pages - 1),
            new ButtonBuilder()
                .setCustomId('game-user:home')
                .setLabel('案内へ戻る')
                .setStyle(ButtonStyle.Secondary)
        ));
        return { embeds: [embed], components };
    }

    updatePreferencePage(guild, userId, requestedPage, values) {
        const games = gameInterestRepository.listActivePreferenceGames(guild.id, userId);
        const pages = Math.max(1, Math.ceil(games.length / PAGE_SIZE));
        const page = Math.max(0, Math.min(requestedPage, pages - 1));
        const pageGames = games.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
        const gameIds = pageGames.map(game => game.id);
        const preferredGameIds = [...new Set(values.map(Number))];
        const pageIdSet = new Set(gameIds);
        if (preferredGameIds.some(id => !Number.isSafeInteger(id) || !pageIdSet.has(id))) {
            throw new Error('編集対象外のゲームは選択できません');
        }

        gameInterestRepository.replacePreferencesForGames({
            guildId: guild.id,
            userId,
            gameIds,
            preferredGameIds
        });
        return this.buildPreferenceEditor(guild, userId, page);
    }

    buildArchivedList(guild, requestedPage = 0) {
        const games = gameInterestRepository.listArchivedGames(guild.id);
        const pages = Math.max(1, Math.ceil(games.length / PAGE_SIZE));
        const page = Math.max(0, Math.min(requestedPage, pages - 1));
        const pageGames = games.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
        const embed = new EmbedBuilder()
            .setColor(0x747F8D)
            .setTitle(`💤 休止中ゲーム ${page + 1}/${pages}`)
            .setDescription(pageGames.length
                ? 'ゲームを選ぶと、現在の希望人数と自分の登録状態を確認できます。'
                : '現在、休止中のゲームはありません。');

        const components = [];
        if (pageGames.length) {
            const select = new StringSelectMenuBuilder()
                .setCustomId(`game-user:select:${page}`)
                .setPlaceholder('ゲームを選択')
                .addOptions(pageGames.map(game => ({
                    label: game.display_name.slice(0, 100),
                    value: String(game.id),
                    description: `復帰希望 ${game.restore_request_count}人`
                })));
            components.push(new ActionRowBuilder().addComponents(select));
        }

        components.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`game-user:archived:${page - 1}`)
                .setLabel('前へ')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0),
            new ButtonBuilder()
                .setCustomId(`game-user:archived:${page + 1}`)
                .setLabel('次へ')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page >= pages - 1)
        ));
        return { embeds: [embed], components };
    }

    buildGameDetail(guild, userId, gameId, page = 0) {
        const game = gameInterestRepository.findCurrentArchivedGame(guild.id, gameId);
        if (!game) throw new Error('対象の休止中ゲームが見つかりません');
        if (!game.archive_snapshot_id) throw new Error('このゲームは現在、復帰希望を受け付けられません');
        const requested = gameInterestRepository.hasRestoreRequest(
            game.archive_snapshot_id,
            userId
        );
        const embed = new EmbedBuilder()
            .setColor(requested ? 0x57F287 : 0x5865F2)
            .setTitle(`🎮 ${game.display_name}`)
            .setDescription([
                `現在の復帰希望：**${game.restore_request_count}人**`,
                `あなたの希望：**${requested ? '登録済み' : '未登録'}**`,
                '',
                '復帰の判断と操作はサーバー管理者が行います。'
            ].join('\n'));
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`game-user:restore-toggle:${game.id}:${page}`)
                .setLabel(requested ? '復帰希望を取り消す' : '復帰を希望する')
                .setStyle(requested ? ButtonStyle.Secondary : ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`game-user:archived:${page}`)
                .setLabel('一覧へ戻る')
                .setStyle(ButtonStyle.Secondary)
        );
        return { embeds: [embed], components: [row] };
    }
}

export default new GameMemberPanelService();

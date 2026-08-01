import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    StringSelectMenuBuilder
} from 'discord.js';
import guildSettingsRepository from '../repositories/guildSettingsRepository.js';
import gameRepository from '../repositories/gameRepository.js';
import activityRepository from '../repositories/activityRepository.js';
import archiveRepository from '../repositories/archiveRepository.js';
import channelActivityService from './channelActivityService.js';
import logger from '../utils/logger.js';

const PAGE_SIZE = 25;

function discordTimestamp(iso) {
    if (!iso) return '記録なし';
    return `<t:${Math.floor(new Date(iso).getTime() / 1000)}:R>`;
}

class GameAdminPanelService {
    buildMainPanel(guild) {
        const counts = gameRepository.counts(guild.id);
        const dormant = channelActivityService.listDormantCandidates(guild.id).length;
        const attention = archiveRepository.listAttention(guild.id).length;
        const guildChannelCount = guild.channels.cache.filter(channel => !channel.isThread?.()).size;
        const embed = new EmbedBuilder()
            .setColor(attention > 0 ? 0xED4245 : 0x5865F2)
            .setTitle('⚙️ ゲームチャンネル管理')
            .setDescription([
                `稼働中：**${counts.active}件**`,
                `休眠候補：**${dormant}件**`,
                `休止中：**${counts.archived}件**`,
                `紐付け切れ：**${counts.missing}件**`,
                `要確認操作：**${attention}件**`,
                '',
                `チャンネル：**${guildChannelCount} / 500**`,
                `ロール：**${guild.roles.cache.size} / 250**`
            ].join('\n'))
            .setFooter({ text: '状態変更時と操作時に更新されます' })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('game:list:dormant:0')
                .setLabel('休眠候補')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('game:list:archived:0')
                .setLabel('休止中')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('game:list:all:0')
                .setLabel('全ゲーム')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('game:panel:reconcile')
                .setLabel('再同期')
                .setStyle(ButtonStyle.Success)
        );
        return { embeds: [embed], components: [row] };
    }

    async ensurePanel(guild) {
        const settings = guildSettingsRepository.find(guild.id);
        if (!settings?.admin_channel_id) return null;
        const channel = guild.channels.cache.get(settings.admin_channel_id)
            ?? await guild.channels.fetch(settings.admin_channel_id).catch(() => null);
        if (!channel?.isSendable?.()) throw new Error('管理パネル用チャンネルへ投稿できません');

        const payload = this.buildMainPanel(guild);
        let message = null;
        if (settings.admin_panel_message_id) {
            message = await channel.messages.fetch(settings.admin_panel_message_id).catch(() => null);
        }
        if (message) {
            await message.edit(payload);
            return message;
        }

        message = await channel.send(payload);
        guildSettingsRepository.setPanelMessage(guild.id, message.id);
        logger.info(`ゲーム管理パネルを設置しました: ${guild.name}/${channel.name}`);
        return message;
    }

    async refreshPanel(guild) {
        try {
            return await this.ensurePanel(guild);
        } catch (error) {
            logger.warn(`ゲーム管理パネルを更新できませんでした (${guild.name}): ${error.message}`);
            return null;
        }
    }

    getList(guildId, mode) {
        if (mode === 'dormant') return channelActivityService.listDormantCandidates(guildId);
        if (mode === 'archived') return gameRepository.listByGuild(guildId, 'archived');
        return gameRepository.listByGuild(guildId);
    }

    buildList(guild, mode, requestedPage = 0) {
        const games = this.getList(guild.id, mode);
        const pages = Math.max(1, Math.ceil(games.length / PAGE_SIZE));
        const page = Math.max(0, Math.min(requestedPage, pages - 1));
        const pageGames = games.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
        const titles = {
            dormant: '💤 休眠候補',
            archived: '📦 休止中ゲーム',
            all: '🎮 全ゲーム'
        };
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(`${titles[mode] ?? titles.all} ${page + 1}/${pages}`)
            .setDescription(pageGames.length
                ? 'ゲームを選択すると詳細と操作を表示します。'
                : '該当するゲームはありません。');

        const components = [];
        if (pageGames.length) {
            const select = new StringSelectMenuBuilder()
                .setCustomId(`game:select:${mode}:${page}`)
                .setPlaceholder('ゲームを選択')
                .addOptions(pageGames.map(game => ({
                    label: game.display_name.slice(0, 100),
                    value: String(game.id),
                    description: game.lifecycle_status === 'archived' ? '休止中' : '稼働中'
                })));
            components.push(new ActionRowBuilder().addComponents(select));
        }
        components.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`game:list:${mode}:${page - 1}`)
                .setLabel('前へ')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0),
            new ButtonBuilder()
                .setCustomId(`game:list:${mode}:${page + 1}`)
                .setLabel('次へ')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page >= pages - 1)
        ));
        return { embeds: [embed], components };
    }

    buildGameDetail(guild, gameId, mode = 'all', page = 0) {
        const game = gameRepository.findById(gameId);
        if (!game || game.guild_id !== guild.id) throw new Error('対象ゲームが見つかりません');
        const activity = game.current_channel_id
            ? activityRepository.findByChannelId(game.current_channel_id)
            : null;
        const embed = new EmbedBuilder()
            .setColor(game.lifecycle_status === 'archived' ? 0x747F8D : 0x57F287)
            .setTitle(`🎮 ${game.display_name}`)
            .setDescription([
                `状態：**${game.lifecycle_status === 'archived' ? '休止中' : '稼働中'}**`,
                `チャンネル：${game.current_channel_id ? `<#${game.current_channel_id}>` : '紐付けなし'}`,
                `最終ユーザー投稿：${discordTimestamp(activity?.last_user_message_at)}`,
                `活動確認：${activity?.reconciliation_status === 'confirmed' ? '確定' : '未確定'}`,
                `アーカイブ対象：${game.archive_excluded ? '対象外' : '対象'}`
            ].join('\n'));

        const actionRow = new ActionRowBuilder();
        if (game.lifecycle_status === 'archived') {
            actionRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`game:restore:confirm:${game.id}:${mode}:${page}`)
                    .setLabel('再稼働')
                    .setStyle(ButtonStyle.Success)
            );
        } else {
            actionRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`game:archive:confirm:${game.id}:${mode}:${page}`)
                    .setLabel('アーカイブ')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId(`game:defer:30:${game.id}:${mode}:${page}`)
                    .setLabel('30日保留')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`game:defer:90:${game.id}:${mode}:${page}`)
                    .setLabel('90日保留')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`game:exclude:${game.id}:${mode}:${page}`)
                    .setLabel(game.archive_excluded ? '対象へ戻す' : '対象外にする')
                    .setStyle(ButtonStyle.Secondary)
            );
        }
        actionRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`game:list:${mode}:${page}`)
                .setLabel('一覧へ戻る')
                .setStyle(ButtonStyle.Secondary)
        );
        return { embeds: [embed], components: [actionRow] };
    }

    buildConfirmation(guild, gameId, action, mode, page) {
        const game = gameRepository.findById(gameId);
        if (!game || game.guild_id !== guild.id) throw new Error('対象ゲームが見つかりません');
        const archive = action === 'archive';
        const embed = new EmbedBuilder()
            .setColor(archive ? 0xED4245 : 0x57F287)
            .setTitle(archive ? 'アーカイブの確認' : '再稼働の確認')
            .setDescription(
                archive
                    ? `**${game.display_name}** を休止中カテゴリへ移動し、書き込みを制限します。チャンネルとロールは削除しません。`
                    : `**${game.display_name}** を保存済みのカテゴリ・権限へ戻します。`
            );
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`game:${action}:execute:${game.id}`)
                .setLabel(archive ? 'アーカイブを実行' : '再稼働を実行')
                .setStyle(archive ? ButtonStyle.Danger : ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`game:detail:${mode}:${page}:${game.id}`)
                .setLabel('キャンセル')
                .setStyle(ButtonStyle.Secondary)
        );
        return { embeds: [embed], components: [row] };
    }

    buildRepairList(guild) {
        const operations = archiveRepository.listAttention(guild.id).slice(0, 5);
        const embed = new EmbedBuilder()
            .setColor(operations.length ? 0xED4245 : 0x57F287)
            .setTitle('🛠️ 要確認操作')
            .setDescription(operations.length
                ? operations.map(op => `#${op.id} ${op.display_name}: ${op.current_phase}\n${op.error_message ?? ''}`).join('\n\n')
                : '復旧が必要な操作はありません。');
        const components = [];
        if (operations.length) {
            components.push(new ActionRowBuilder().addComponents(
                operations.map(op => new ButtonBuilder()
                    .setCustomId(`game:repair:${op.id}`)
                    .setLabel(`#${op.id} を稼働状態へ復旧`)
                    .setStyle(ButtonStyle.Danger))
            ));
        }
        return { embeds: [embed], components };
    }
}

export default new GameAdminPanelService();

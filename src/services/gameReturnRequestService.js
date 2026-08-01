import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder
} from 'discord.js';
import gameRepository from '../repositories/gameRepository.js';
import gameInterestRepository from '../repositories/gameInterestRepository.js';
import guildSettingsRepository from '../repositories/guildSettingsRepository.js';
import logger from '../utils/logger.js';

class GameReturnRequestService {
    buildOpenAlert(game, snapshotId, count, threshold) {
        const embed = new EmbedBuilder()
            .setColor(0xFEE75C)
            .setTitle('🔔 復帰希望が設定人数に達しました')
            .setDescription([
                `ゲーム：**${game.display_name}**`,
                `復帰希望：**${count}人**`,
                `通知基準：**${threshold}人**`,
                '',
                '再稼働は自動では行われません。'
            ].join('\n'));
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`game:restore-alert:${game.id}`)
                .setLabel('再稼働を確認')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`game:restore-dismiss:${snapshotId}`)
                .setLabel('今回は見送る')
                .setStyle(ButtonStyle.Secondary)
        );
        return { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
    }

    buildDismissedAlert(game, count) {
        return {
            embeds: [new EmbedBuilder()
                .setColor(0x747F8D)
                .setTitle('復帰希望を今回は見送りました')
                .setDescription(`**${game.display_name}** の復帰希望は現在 **${count}人** です。\n希望データは保持されています。`)],
            components: [],
            allowedMentions: { parse: [] }
        };
    }

    buildResolvedAlert(game) {
        return {
            embeds: [new EmbedBuilder()
                .setColor(0x57F287)
                .setTitle('✅ ゲームを再稼働しました')
                .setDescription(`**${game.display_name}** は再稼働済みです。`)],
            components: [],
            allowedMentions: { parse: [] }
        };
    }

    async toggle({ guild, gameId, userId }) {
        const game = gameInterestRepository.findCurrentArchivedGame(guild.id, gameId);
        if (!game) throw new Error('対象の休止中ゲームが見つかりません');
        if (!game.archive_snapshot_id) throw new Error('このゲームは現在、復帰希望を受け付けられません');

        const result = gameInterestRepository.toggleRestoreRequest({
            guildId: guild.id,
            gameId: game.id,
            snapshotId: game.archive_snapshot_id,
            userId
        });
        try {
            await this.syncAdminAlert(guild, {
                ...game,
                restore_request_count: result.count
            });
        } catch (error) {
            logger.warn(`復帰希望の管理者通知を更新できませんでした (${guild.name}/${game.display_name}): ${error.message}`);
        }
        return { ...result, game, snapshotId: game.archive_snapshot_id };
    }

    async reconcileGuild(guild) {
        for (const game of gameInterestRepository.listArchivedGames(guild.id)) {
            if (!game.archive_snapshot_id) continue;
            try {
                await this.syncAdminAlert(guild, game);
            } catch (error) {
                logger.warn(`復帰希望通知を再同期できませんでした (${guild.name}/${game.display_name}): ${error.message}`);
            }
        }
    }

    async syncAdminAlert(guild, game) {
        const settings = guildSettingsRepository.find(guild.id);
        if (!settings?.admin_channel_id) return null;
        const threshold = settings.restore_request_threshold ?? 5;
        let alert = gameInterestRepository.findAlert(game.archive_snapshot_id);

        if (alert) {
            alert = gameInterestRepository.updateAlertCount(
                game.archive_snapshot_id,
                game.restore_request_count
            );
            if (alert.status === 'open' && alert.message_id) {
                const message = await this.fetchAlertMessage(guild, alert);
                if (message) {
                    await message.edit(this.buildOpenAlert(
                        game,
                        game.archive_snapshot_id,
                        game.restore_request_count,
                        threshold
                    ));
                }
            }
            return alert;
        }

        if (game.restore_request_count < threshold) return null;
        const reserved = gameInterestRepository.reserveAlert({
            snapshotId: game.archive_snapshot_id,
            gameId: game.id,
            guildId: guild.id,
            adminChannelId: settings.admin_channel_id,
            count: game.restore_request_count
        });
        if (!reserved) return gameInterestRepository.findAlert(game.archive_snapshot_id);

        try {
            const channel = guild.channels.cache.get(settings.admin_channel_id)
                ?? await guild.channels.fetch(settings.admin_channel_id).catch(() => null);
            if (!channel?.isSendable?.()) throw new Error('管理チャンネルへ投稿できません');
            const message = await channel.send(this.buildOpenAlert(
                game,
                game.archive_snapshot_id,
                game.restore_request_count,
                threshold
            ));
            const attached = gameInterestRepository.setAlertMessage(
                game.archive_snapshot_id,
                message.id
            );
            if (attached?.status !== 'open' || attached.message_id !== message.id) {
                const currentGame = gameRepository.findById(game.id) ?? game;
                await message.edit(this.buildResolvedAlert(currentGame));
            }
            return attached;
        } catch (error) {
            gameInterestRepository.releaseUnsentAlert(game.archive_snapshot_id);
            throw error;
        }
    }

    dismiss(guildId, snapshotId) {
        const alert = gameInterestRepository.findAlert(snapshotId);
        if (!alert || alert.guild_id !== guildId || alert.status !== 'open') {
            throw new Error('対象の復帰希望通知が見つかりません');
        }
        const game = gameRepository.findById(alert.game_id);
        if (!game || game.guild_id !== guildId) throw new Error('対象ゲームが見つかりません');
        const dismissed = gameInterestRepository.dismissAlert(guildId, snapshotId);
        return {
            alert: dismissed,
            game,
            payload: this.buildDismissedAlert(game, dismissed.request_count)
        };
    }

    async resolveAfterRestore({ guild, game, snapshotId }) {
        try {
            const alert = gameInterestRepository.findAlert(snapshotId);
            gameInterestRepository.resolveAlert(snapshotId);
            if (!alert?.message_id) return;
            const message = await this.fetchAlertMessage(guild, alert);
            if (message) await message.edit(this.buildResolvedAlert(game));
        } catch (error) {
            logger.warn(`復帰希望通知を再稼働済みに更新できませんでした (${guild.name}/${game.display_name}): ${error.message}`);
        }
    }

    async fetchAlertMessage(guild, alert) {
        const channel = guild.channels.cache.get(alert.admin_channel_id)
            ?? await guild.channels.fetch(alert.admin_channel_id).catch(() => null);
        if (!channel?.messages) return null;
        return channel.messages.fetch(alert.message_id).catch(() => null);
    }
}

export default new GameReturnRequestService();

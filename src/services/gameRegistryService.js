import { ChannelType } from 'discord.js';
import config from '../config/configLoader.js';
import database from '../repositories/database.js';
import guildSettingsRepository from '../repositories/guildSettingsRepository.js';
import gameRepository from '../repositories/gameRepository.js';
import logger from '../utils/logger.js';

class GameRegistryService {
    findGameByChannelId(channelId) {
        return gameRepository.findByChannelId(channelId);
    }

    findActiveGameByChannel(channel) {
        if (!database.isInitialized || !channel) return null;
        const channelId = channel.isThread?.() ? channel.parentId : channel.id;
        return gameRepository.findActiveByChannelId(channelId);
    }

    findGameByChannel(channel) {
        if (!database.isInitialized || !channel) return null;
        const channelId = channel.isThread?.() ? channel.parentId : channel.id;
        return gameRepository.findByChannelId(channelId);
    }

    async bootstrapGuild(guild) {
        if (!database.isInitialized) return null;
        let settings = guildSettingsRepository.find(guild.id);
        if (settings?.game_category_id) return settings;

        const configuredName = config.get('features.autoRole.gameCategoryName') || 'ゲームチャンネル';
        const matches = guild.channels.cache.filter(
            channel => channel.type === ChannelType.GuildCategory && channel.name === configuredName
        );
        if (matches.size !== 1) {
            if (matches.size > 1) {
                logger.warn(`ゲームカテゴリ名が重複しています (${guild.name}): ${configuredName}`);
            }
            return settings;
        }

        settings = guildSettingsRepository.upsert({
            guildId: guild.id,
            gameCategoryId: matches.first().id
        });
        logger.info(`既存設定からゲームカテゴリを登録しました: ${guild.name} / ${configuredName}`);
        return settings;
    }

    registerChannel(channel) {
        if (!database.isInitialized || !channel?.guild) return null;
        const settings = guildSettingsRepository.find(channel.guild.id);
        if (!settings?.game_category_id || channel.parentId !== settings.game_category_id) return null;
        if (channel.type !== ChannelType.GuildText) return null;

        const roles = channel.guild.roles.cache.filter(role => role.name === channel.name);
        const roleId = roles.size === 1 ? roles.first().id : null;
        if (roles.size > 1) {
            logger.warn(`同名ロールが複数あるため自動紐付けしません: ${channel.guild.name}/${channel.name}`);
        }

        return gameRepository.registerChannel({
            guildId: channel.guild.id,
            channelId: channel.id,
            channelName: channel.name,
            parentCategoryId: channel.parentId,
            roleId,
            activeFrom: channel.createdAt?.toISOString?.() ?? new Date().toISOString()
        });
    }

    async reconcileGuild(guild) {
        if (!database.isInitialized) return { registered: 0, detached: 0 };
        const settings = await this.bootstrapGuild(guild);
        if (!settings?.game_category_id) return { registered: 0, detached: 0 };

        let registered = 0;
        for (const channel of guild.channels.cache.values()) {
            if (channel.type !== ChannelType.GuildText) continue;
            if (channel.parentId !== settings.game_category_id) continue;
            if (this.registerChannel(channel)) registered++;
        }

        let detached = 0;
        for (const game of gameRepository.listByGuild(guild.id)) {
            if (!game.current_channel_id) continue;
            const channel = guild.channels.cache.get(game.current_channel_id);
            if (!channel) {
                gameRepository.detachChannel(game.current_channel_id, 'reconcile_missing');
                detached++;
            }
        }

        logger.info(`ゲームチャンネル整合完了: ${guild.name} (登録=${registered}, 紐付け切れ=${detached})`);
        return { registered, detached };
    }

    async reconcileAll(client) {
        const results = [];
        for (const guild of client.guilds.cache.values()) {
            try {
                results.push({ guildId: guild.id, ...(await this.reconcileGuild(guild)) });
            } catch (error) {
                logger.error(`ゲームチャンネル整合エラー (${guild.name}):`, error);
            }
        }
        return results;
    }

    handleChannelUpdate(channel) {
        if (!database.isInitialized || !channel?.guild) return null;
        const existing = gameRepository.findByChannelId(channel.id);
        if (existing) {
            return gameRepository.updateChannelMetadata(channel.id, {
                channelName: channel.name,
                parentCategoryId: channel.parentId
            });
        }
        return this.registerChannel(channel);
    }

    handleChannelDelete(channel) {
        if (!database.isInitialized || !channel?.id) return null;
        return gameRepository.detachChannel(channel.id, 'channel_deleted');
    }
}

export default new GameRegistryService();


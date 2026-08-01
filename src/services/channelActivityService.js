import database from '../repositories/database.js';
import guildSettingsRepository from '../repositories/guildSettingsRepository.js';
import gameRepository from '../repositories/gameRepository.js';
import activityRepository from '../repositories/activityRepository.js';
import logger from '../utils/logger.js';

const PAGE_SIZE = 100;
const DEFAULT_SCAN_LIMIT = 500;

class ChannelActivityService {
    recordMessage(message) {
        if (!database.isInitialized || !message?.guild || !message.channel) return null;
        const channelId = message.channel.isThread?.() ? message.channel.parentId : message.channel.id;
        if (!gameRepository.findByChannelId(channelId)) return null;

        const timestamp = message.createdAt?.toISOString?.() ?? new Date().toISOString();
        const isHuman = !message.author?.bot && !message.webhookId;
        return activityRepository.record(channelId, {
            anyAt: timestamp,
            userAt: isHuman ? timestamp : null,
            userId: isHuman ? message.author.id : null
        });
    }

    getCutoff(guildId, now = new Date()) {
        const settings = guildSettingsRepository.find(guildId);
        const days = settings?.dormant_after_days ?? 90;
        return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    }

    listDormantCandidates(guildId, now = new Date()) {
        return activityRepository.listDormantCandidates(guildId, this.getCutoff(guildId, now).toISOString());
    }

    async reconcileChannel(channel, { cutoff = null, scanLimit = DEFAULT_SCAN_LIMIT } = {}) {
        if (!database.isInitialized || !channel?.messages || !channel.guild) return null;
        const game = gameRepository.findByChannelId(channel.id);
        if (!game) return null;

        const effectiveCutoff = cutoff ?? this.getCutoff(channel.guild.id);
        let before;
        let scanned = 0;
        let confirmed = false;
        let latestHuman = null;

        while (scanned < scanLimit) {
            const limit = Math.min(PAGE_SIZE, scanLimit - scanned);
            const messages = await channel.messages.fetch({
                limit,
                ...(before ? { before } : {})
            });
            if (!messages?.size) {
                confirmed = true;
                break;
            }

            const ordered = [...messages.values()];
            scanned += ordered.length;
            latestHuman = ordered.find(message => !message.author?.bot && !message.webhookId) ?? null;
            if (latestHuman) {
                confirmed = true;
                break;
            }

            const oldest = ordered.at(-1);
            if (!oldest) {
                confirmed = true;
                break;
            }
            if (oldest.createdAt <= effectiveCutoff) {
                confirmed = true;
                break;
            }
            before = oldest.id;
        }

        return activityRepository.markReconciled(channel.id, {
            lastUserMessageAt: latestHuman?.createdAt?.toISOString?.() ?? null,
            lastUserId: latestHuman?.author?.id ?? null,
            confirmed
        });
    }

    async reconcileGuild(guild) {
        const cutoff = this.getCutoff(guild.id);
        const games = gameRepository.listByGuild(guild.id, 'active');
        let reconciled = 0;
        let unknown = 0;
        for (const game of games) {
            if (!game.current_channel_id) continue;
            const channel = guild.channels.cache.get(game.current_channel_id);
            if (!channel?.messages) continue;
            try {
                const result = await this.reconcileChannel(channel, { cutoff });
                if (result?.reconciliation_status === 'confirmed') reconciled++;
                else unknown++;
            } catch (error) {
                unknown++;
                logger.warn(`活動状況の整合に失敗しました (${guild.name}/${game.display_name}): ${error.message}`);
            }
        }
        logger.info(`活動状況整合完了: ${guild.name} (確定=${reconciled}, 未確定=${unknown})`);
        return { reconciled, unknown };
    }

    async reconcileAll(client) {
        for (const guild of client.guilds.cache.values()) {
            await this.reconcileGuild(guild);
        }
    }
}

export default new ChannelActivityService();


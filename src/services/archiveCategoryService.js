import { ChannelType, PermissionFlagsBits } from 'discord.js';
import archiveRepository from '../repositories/archiveRepository.js';
import guildSettingsRepository from '../repositories/guildSettingsRepository.js';

const CATEGORY_CAPACITY = 50;
const GUILD_CHANNEL_CAPACITY = 500;

class ArchiveCategoryService {
    buildPermissionOverwrites(guild, settings) {
        const denied = [
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.AddReactions,
            PermissionFlagsBits.CreatePublicThreads,
            PermissionFlagsBits.CreatePrivateThreads,
            PermissionFlagsBits.SendMessagesInThreads
        ];
        if (settings?.archive_visibility === 'hidden') denied.push(PermissionFlagsBits.ViewChannel);
        return [{
            id: guild.roles.everyone.id,
            deny: denied
        }, {
            id: guild.members.me.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.ManageChannels
            ]
        }];
    }

    childrenCount(guild, categoryId) {
        return guild.channels.cache.filter(channel => channel.parentId === categoryId).size;
    }

    async getOrCreate(guild) {
        const settings = guildSettingsRepository.find(guild.id);
        const registered = archiveRepository.listCategories(guild.id);
        for (const row of registered) {
            const category = guild.channels.cache.get(row.category_id);
            if (category?.type !== ChannelType.GuildCategory) continue;
            if (this.childrenCount(guild, category.id) < CATEGORY_CAPACITY) {
                await this.configurePermissions(guild, category, settings);
                return category;
            }
        }

        const guildChannelCount = guild.channels.cache.filter(channel => !channel.isThread?.()).size;
        if (guildChannelCount >= GUILD_CHANNEL_CAPACITY) {
            throw new Error('サーバーのチャンネル数が上限に達しているため、休止中カテゴリを作成できません');
        }

        const nextSequence = Math.max(0, ...registered.map(row => row.sequence)) + 1;
        const category = await guild.channels.create({
            name: nextSequence === 1 ? '休止中ゲーム' : `休止中ゲーム-${nextSequence}`,
            type: ChannelType.GuildCategory,
            permissionOverwrites: this.buildPermissionOverwrites(guild, settings),
            reason: 'ゲームチャンネルのソフトアーカイブ先'
        });
        archiveRepository.registerCategory(guild.id, category.id, nextSequence);
        return category;
    }

    async configurePermissions(guild, category, settings) {
        await category.permissionOverwrites.set(
            this.buildPermissionOverwrites(guild, settings),
            '休止中ゲームカテゴリの権限を更新'
        );
    }
}

export default new ArchiveCategoryService();

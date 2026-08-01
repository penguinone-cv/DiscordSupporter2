import { PermissionFlagsBits } from 'discord.js';
import gameRepository from '../repositories/gameRepository.js';
import guildSettingsRepository from '../repositories/guildSettingsRepository.js';
import archiveRepository from '../repositories/archiveRepository.js';
import archiveCategoryService from './archiveCategoryService.js';
import gameReturnRequestService from './gameReturnRequestService.js';
import logger from '../utils/logger.js';

function serializeChannel(channel) {
    return {
        name: channel.name,
        parentId: channel.parentId,
        rawPosition: channel.rawPosition ?? channel.position ?? 0,
        topic: channel.topic ?? null,
        nsfw: Boolean(channel.nsfw),
        rateLimitPerUser: channel.rateLimitPerUser ?? 0,
        defaultAutoArchiveDuration: channel.defaultAutoArchiveDuration ?? null,
        defaultThreadRateLimitPerUser: channel.defaultThreadRateLimitPerUser ?? 0,
        permissionsLocked: channel.permissionsLocked,
        permissionOverwrites: [...channel.permissionOverwrites.cache.values()].map(overwrite => ({
            id: overwrite.id,
            type: overwrite.type,
            allow: overwrite.allow.bitfield.toString(),
            deny: overwrite.deny.bitfield.toString()
        }))
    };
}

function archivedTopic(topic) {
    const prefix = '⏸️ 休止中';
    if (!topic) return prefix;
    if (topic.startsWith(prefix)) return topic.slice(0, 1024);
    return `${prefix} | ${topic}`.slice(0, 1024);
}

class GameArchiveService {
    assertAdministratorAccess(guild, channel) {
        const me = guild.members.me;
        if (!me) throw new Error('Bot自身のメンバー情報を取得できません');
        const guildPermissions = me.permissions;
        const channelPermissions = channel.permissionsFor?.(me) ?? guildPermissions;
        if (!guildPermissions?.has(PermissionFlagsBits.ManageChannels)
            || !guildPermissions?.has(PermissionFlagsBits.ManageRoles)
            || !channelPermissions?.has(PermissionFlagsBits.ManageChannels)) {
            throw new Error('Botにチャンネル管理・ロール管理権限が不足しています');
        }
        if (channel.manageable === false) throw new Error('Botがこのチャンネルを管理できません');
    }

    async fetchGameChannel(guild, game) {
        if (!game.current_channel_id) throw new Error('現在のゲームチャンネルが紐付いていません');
        const channel = guild.channels.cache.get(game.current_channel_id)
            ?? await guild.channels.fetch(game.current_channel_id);
        if (!channel) throw new Error('ゲームチャンネルが見つかりません');
        return channel;
    }

    async archive({ guild, gameId, userId }) {
        const game = gameRepository.findById(gameId);
        if (!game || game.guild_id !== guild.id) throw new Error('対象ゲームが見つかりません');
        if (game.lifecycle_status !== 'active') throw new Error('このゲームは稼働中ではありません');
        if (archiveRepository.hasBlockingOperation(game.id)) {
            throw new Error('このゲームには復旧が必要、または処理中の操作があります');
        }

        const channel = await this.fetchGameChannel(guild, game);
        this.assertAdministratorAccess(guild, channel);
        const snapshotData = {
            ...serializeChannel(channel),
            roleId: game.current_role_id ?? null
        };
        let operation;

        try {
            operation = archiveRepository.beginOperation({
                gameId: game.id,
                type: 'archive',
                userId,
                snapshot: { channelId: channel.id, data: snapshotData }
            });
        } catch (error) {
            if (String(error.message).includes('UNIQUE')) {
                throw new Error('このゲームには処理中の操作があります');
            }
            throw error;
        }

        try {
            archiveRepository.updateOperation(operation.id, { phase: 'preparing_category' });
            const archiveCategory = await archiveCategoryService.getOrCreate(guild);

            archiveRepository.updateOperation(operation.id, { phase: 'moving_channel' });
            await channel.setParent(archiveCategory.id, {
                lockPermissions: true,
                reason: `ゲームをソフトアーカイブ (game=${game.id}, by=${userId})`
            });

            archiveRepository.updateOperation(operation.id, { phase: 'updating_topic' });
            await channel.setTopic(archivedTopic(snapshotData.topic), 'ゲームをソフトアーカイブ');

            archiveRepository.updateOperation(operation.id, { phase: 'finalizing' });
            const archived = gameRepository.setArchived(game.id);
            archiveRepository.updateOperation(operation.id, {
                status: 'succeeded',
                phase: 'completed'
            });
            return archived;
        } catch (error) {
            logger.error(`ソフトアーカイブ失敗 (game=${game.id}):`, error);
            try {
                archiveRepository.updateOperation(operation.id, {
                    phase: 'rolling_back',
                    error: error.message
                });
                await this.applySnapshot(guild, channel, snapshotData);
                gameRepository.setActive(game.id);
                archiveRepository.updateOperation(operation.id, {
                    status: 'rolled_back',
                    phase: 'rolled_back',
                    error: error.message
                });
            } catch (rollbackError) {
                logger.error(`アーカイブのロールバック失敗 (game=${game.id}):`, rollbackError);
                archiveRepository.updateOperation(operation.id, {
                    status: 'manual_attention',
                    phase: 'rollback_failed',
                    error: `${error.message} / ロールバック: ${rollbackError.message}`
                });
            }
            throw error;
        }
    }

    async restore({ guild, gameId, userId }) {
        const game = gameRepository.findById(gameId);
        if (!game || game.guild_id !== guild.id) throw new Error('対象ゲームが見つかりません');
        if (game.lifecycle_status !== 'archived') throw new Error('このゲームは休止中ではありません');
        if (archiveRepository.hasBlockingOperation(game.id)) {
            throw new Error('このゲームには復旧が必要、または処理中の操作があります');
        }
        const snapshot = archiveRepository.latestSnapshot(game.id);
        if (!snapshot) throw new Error('復元用スナップショットがありません');

        const channel = await this.fetchGameChannel(guild, game);
        this.assertAdministratorAccess(guild, channel);
        let operation;
        try {
            operation = archiveRepository.beginOperation({
                gameId: game.id,
                type: 'restore',
                userId
            });
        } catch (error) {
            if (String(error.message).includes('UNIQUE')) {
                throw new Error('このゲームには処理中の操作があります');
            }
            throw error;
        }

        try {
            const parsed = archiveRepository.getSnapshot(operation.snapshot_id);
            if (!parsed) throw new Error('復元用スナップショットを読み込めません');
            archiveRepository.updateOperation(operation.id, { phase: 'restoring_channel' });
            await this.applySnapshot(guild, channel, parsed.data);
            archiveRepository.updateOperation(operation.id, { phase: 'finalizing' });
            const active = gameRepository.setActive(game.id);
            if (parsed.data.roleId && guild.roles.cache.has(parsed.data.roleId)) {
                gameRepository.setRole(game.id, parsed.data.roleId);
            }
            archiveRepository.markSnapshotRestored(parsed.id);
            archiveRepository.updateOperation(operation.id, {
                status: 'succeeded',
                phase: 'completed'
            });
            await gameReturnRequestService.resolveAfterRestore({
                guild,
                game: active,
                snapshotId: parsed.id
            });
            return active;
        } catch (error) {
            logger.error(`ゲーム再稼働失敗 (game=${game.id}):`, error);
            archiveRepository.updateOperation(operation.id, {
                status: 'manual_attention',
                phase: 'restore_failed',
                error: error.message
            });
            throw error;
        }
    }

    async repairToActive({ guild, operationId }) {
        const operation = archiveRepository.findOperation(operationId);
        if (!operation || operation.status !== 'manual_attention') {
            throw new Error('復旧対象の操作が見つかりません');
        }
        const game = gameRepository.findById(operation.game_id);
        if (!game || game.guild_id !== guild.id) throw new Error('対象ゲームが見つかりません');
        const snapshot = archiveRepository.getSnapshot(operation.snapshot_id);
        if (!snapshot) throw new Error('復旧用スナップショットがありません');
        const channel = await this.fetchGameChannel(guild, game);
        this.assertAdministratorAccess(guild, channel);

        await this.applySnapshot(guild, channel, snapshot.data);
        const active = gameRepository.setActive(game.id);
        if (snapshot.data.roleId && guild.roles.cache.has(snapshot.data.roleId)) {
            gameRepository.setRole(game.id, snapshot.data.roleId);
        }
        archiveRepository.markSnapshotRestored(snapshot.id);
        archiveRepository.updateOperation(operation.id, {
            status: operation.operation_type === 'archive' ? 'rolled_back' : 'succeeded',
            phase: 'repaired',
            error: null
        });
        await gameReturnRequestService.resolveAfterRestore({
            guild,
            game: active,
            snapshotId: snapshot.id
        });
        return active;
    }

    async applySnapshot(guild, channel, snapshot) {
        const settings = guildSettingsRepository.find(guild.id);
        const originalParent = snapshot.parentId
            ? guild.channels.cache.get(snapshot.parentId) ?? await guild.channels.fetch(snapshot.parentId).catch(() => null)
            : null;
        const fallbackParent = settings?.game_category_id
            ? guild.channels.cache.get(settings.game_category_id)
                ?? await guild.channels.fetch(settings.game_category_id).catch(() => null)
            : null;
        const targetParent = originalParent ?? fallbackParent;
        if (!targetParent) throw new Error('復元先のゲームカテゴリが見つかりません');

        await channel.setParent(targetParent.id, {
            lockPermissions: snapshot.permissionsLocked === true,
            reason: 'ゲームチャンネル設定を復元'
        });

        if (snapshot.permissionsLocked !== true) {
            const hasMemberOverwrites = snapshot.permissionOverwrites.some(overwrite => overwrite.type === 1);
            if (hasMemberOverwrites) {
                await guild.members.fetch().catch(error => {
                    logger.warn(`メンバー権限の復元前取得に失敗しました: ${error.message}`);
                });
            }
            const overwrites = snapshot.permissionOverwrites
                .filter(overwrite => overwrite.id === guild.id
                    || guild.roles.cache.has(overwrite.id)
                    || guild.members.cache.has(overwrite.id))
                .map(overwrite => ({
                    id: overwrite.id,
                    type: overwrite.type,
                    allow: BigInt(overwrite.allow),
                    deny: BigInt(overwrite.deny)
                }));
            const skipped = snapshot.permissionOverwrites.length - overwrites.length;
            if (skipped > 0) {
                logger.warn(`${skipped}件の削除済み対象に対する権限上書きをスキップしました`);
            }
            await channel.permissionOverwrites.set(overwrites, 'ゲームチャンネル権限を復元');
        }

        const editOptions = {
            name: snapshot.name,
            topic: snapshot.topic,
            nsfw: snapshot.nsfw,
            rateLimitPerUser: snapshot.rateLimitPerUser,
            defaultThreadRateLimitPerUser: snapshot.defaultThreadRateLimitPerUser,
            reason: 'ゲームチャンネル設定を復元'
        };
        if (snapshot.defaultAutoArchiveDuration) {
            editOptions.defaultAutoArchiveDuration = snapshot.defaultAutoArchiveDuration;
        }
        await channel.edit(editOptions);
        try {
            await channel.setPosition(snapshot.rawPosition, { reason: 'ゲームチャンネル位置を復元' });
        } catch (error) {
            logger.warn(`チャンネル位置を完全には復元できませんでした: ${error.message}`);
        }
    }
}

export { serializeChannel };
export default new GameArchiveService();

import logger from '../utils/logger.js';
import config from '../config/configLoader.js';
import database from '../repositories/database.js';
import gameRepository from '../repositories/gameRepository.js';
import gameRegistryService from './gameRegistryService.js';

/**
 * ロール管理サービス
 */
class RoleManager {
    constructor() {
        this.gameCategoryName = null;
    }

    /**
     * 初期化
     */
    initialize() {
        this.gameCategoryName = config.get('features.autoRole.gameCategoryName') || 'ゲームチャンネル';
        logger.info(`ロール管理初期化: カテゴリ名="${this.gameCategoryName}"`);
    }

    /**
     * チャンネルがゲームカテゴリに属しているか確認
     * @param {Channel} channel - Discordチャンネル
     * @returns {boolean}
     */
    isGameChannel(channel) {
        if (database.isInitialized) {
            return Boolean(gameRegistryService.findActiveGameByChannel(channel));
        }
        if (!channel.parent) return false;
        return channel.parent.name === this.gameCategoryName;
    }

    findRoleForGame(guild, game, channelName = game.display_name) {
        if (game.current_role_id) {
            const byId = guild.roles.cache.get(game.current_role_id);
            if (byId) return byId;
        }
        const matches = guild.roles.cache.filter(role => role.name === channelName);
        return matches.size === 1 ? matches.first() : null;
    }

    /**
     * チャンネル名に基づいてロールを付与
     * @param {GuildMember} member - サーバーメンバー
     * @param {Channel} channel - チャンネル
     */
    async assignRoleByChannel(member, channel) {
        try {
            // ゲームカテゴリのチャンネルか確認
            if (!this.isGameChannel(channel)) {
                return;
            }

            const game = database.isInitialized
                ? gameRegistryService.findActiveGameByChannel(channel)
                : null;
            if (database.isInitialized && !game) return;

            const roleName = game?.display_name ?? channel.name;
            const guild = channel.guild;

            // ロールを検索
            let role = game
                ? this.findRoleForGame(guild, game, channel.name)
                : guild.roles.cache.find(r => r.name === roleName);

            // ロールが存在しない場合は作成
            if (!role) {
                logger.info(`ロール "${roleName}" を作成します`);
                role = await guild.roles.create({
                    name: roleName,
                    reason: `${roleName}チャンネルの自動ロール作成`
                });
                if (game) gameRepository.setRole(game.id, role.id);
            } else if (game && game.current_role_id !== role.id) {
                gameRepository.setRole(game.id, role.id);
            }

            // すでにロールを持っているか確認
            if (member.roles.cache.has(role.id)) {
                logger.debug(`${member.user.tag} は既に "${roleName}" ロールを持っています`);
                return;
            }

            // ロールを付与
            await member.roles.add(role);
            logger.info(`${member.user.tag} に "${roleName}" ロールを付与しました`);

        } catch (error) {
            logger.error('ロール付与エラー:', error);
        }
    }
}

export default new RoleManager();

import logger from '../utils/logger.js';
import config from '../config/configLoader.js';

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
        if (!channel.parent) return false;
        return channel.parent.name === this.gameCategoryName;
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

            const roleName = channel.name;
            const guild = channel.guild;

            // ロールを検索
            let role = guild.roles.cache.find(r => r.name === roleName);

            // ロールが存在しない場合は作成
            if (!role) {
                logger.info(`ロール "${roleName}" を作成します`);
                role = await guild.roles.create({
                    name: roleName,
                    reason: `${roleName}チャンネルの自動ロール作成`
                });
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

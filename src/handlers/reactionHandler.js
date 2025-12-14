import roleManager from '../services/roleManager.js';
import config from '../config/configLoader.js';
import logger from '../utils/logger.js';

/**
 * リアクション追加イベントハンドラ
 */
export default async function handleReactionAdd(reaction, user) {
    // Botのリアクションは無視
    if (user.bot) return;

    // 自動ロール機能が無効なら終了
    if (!config.get('features.autoRole.enabled')) return;

    try {
        // パーシャルの場合はフルデータを取得
        if (reaction.partial) {
            await reaction.fetch();
        }

        const message = reaction.message;
        const channel = message.channel;
        const guild = message.guild;

        if (!guild) return;

        // メンバー情報を取得
        const member = await guild.members.fetch(user.id);

        // ゲームチャンネルでの自動ロール付与
        await roleManager.assignRoleByChannel(member, channel);

    } catch (error) {
        logger.error('リアクション処理エラー:', error);
    }
}

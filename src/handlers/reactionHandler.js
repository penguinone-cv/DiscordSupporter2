import roleManager from '../services/roleManager.js';
import gameRecruitmentService from '../services/gameRecruitmentService.js';
import config from '../config/configLoader.js';
import logger from '../utils/logger.js';

async function handleRecruitmentReaction(reaction, user, removed) {
    try {
        await gameRecruitmentService.handleReactionChange(reaction, user, { removed });
    } catch (error) {
        logger.error('募集リアクション処理エラー:', error);
    }
}

/**
 * リアクション追加イベントハンドラ
 */
export default async function handleReactionAdd(reaction, user) {
    // Botのリアクションは無視
    if (user.bot) return;

    // 募集リアクションは自動ロール機能の有効・無効にかかわらず処理する
    await handleRecruitmentReaction(reaction, user, false);

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

/**
 * リアクション削除イベントハンドラ
 * 募集メッセージの参加者一覧を、削除後の最新状態へ更新する。
 */
export async function handleReactionRemove(reaction, user) {
    if (user.bot) return;
    await handleRecruitmentReaction(reaction, user, true);
}

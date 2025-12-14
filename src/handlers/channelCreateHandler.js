import logger from '../utils/logger.js';

/**
 * チャンネル作成イベントハンドラ
 */
export default async function handleChannelCreate(channel) {
    try {
        // テキストチャンネルのみ対応
        if (!channel.isTextBased()) {
            return;
        }

        // DMチャンネルは無視
        if (!channel.guild) {
            return;
        }

        // 初期メッセージを投稿
        const welcomeMessage = `ここは${channel.name}の遊び場`;
        await channel.send(welcomeMessage);

        logger.info(`チャンネル作成: ${channel.name} に初期メッセージを投稿しました`);
    } catch (error) {
        logger.error('チャンネル作成時のメッセージ投稿エラー:', error);
    }
}

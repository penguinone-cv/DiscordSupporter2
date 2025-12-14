import recruitmentDetector from '../services/recruitmentDetector.js';
import roleManager from '../services/roleManager.js';
import config from '../config/configLoader.js';
import logger from '../utils/logger.js';

/**
 * メッセージイベントハンドラ
 */
export default async function handleMessage(message) {
    // Botのメッセージは無視
    if (message.author.bot) return;

    try {
        // 1. メンション機能
        if (config.get('features.mention.enabled') && message.mentions.has(message.client.user)) {
            const response = config.get('features.mention.response') || 'はーい';
            await message.reply(response);
            logger.info(`メンションに応答: ${message.author.tag}`);
        }

        // 2. 募集メッセージ検出
        if (config.get('features.recruitmentDetection.enabled')) {
            const detection = await recruitmentDetector.detect(message.content, message.channel);

            if (detection.isRecruitment) {
                // チャンネル名と同じロールを検索
                const roleName = message.channel.name;
                const role = message.guild?.roles.cache.find(r => r.name === roleName);

                // ロールメンションを含むメッセージを作成
                const roleMention = role ? `<@&${role.id}>` : '';
                const content = roleMention
                    ? `${roleMention} 募集らしきメッセージが送られていそうですよ？`
                    : `募集らしきメッセージが送られていそうですよ？`;

                await message.reply({
                    content: content,
                    allowedMentions: {
                        repliedUser: false,
                        roles: role ? [role.id] : []
                    }
                });
                logger.info(`募集メッセージ検出: "${message.content.substring(0, 50)}..."`);
            }
        }

        // 3. ゲームチャンネルでの自動ロール付与
        if (config.get('features.autoRole.enabled')) {
            await roleManager.assignRoleByChannel(message.member, message.channel);
        }

    } catch (error) {
        logger.error('メッセージ処理エラー:', error);
    }
}

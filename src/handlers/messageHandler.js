import recruitmentDetector from '../services/recruitmentDetector.js';
import roleManager from '../services/roleManager.js';
import config from '../config/configLoader.js';
import logger from '../utils/logger.js';

// 処理済みメッセージのキャッシュ（重複防止）
const processedMessages = new Set();
const CACHE_CLEANUP_INTERVAL = 60 * 60 * 1000; // 1時間ごとにクリーンアップ
const CACHE_MAX_SIZE = 10000; // 最大キャッシュサイズ

// 定期的にキャッシュをクリーンアップ
setInterval(() => {
    if (processedMessages.size > CACHE_MAX_SIZE) {
        processedMessages.clear();
        logger.info('メッセージキャッシュをクリアしました');
    }
}, CACHE_CLEANUP_INTERVAL);

/**
 * メッセージイベントハンドラ
 */
export default async function handleMessage(message) {
    // Botのメッセージは無視
    if (message.author.bot) return;

    // 既に処理済みのメッセージは無視（募集検出の重複防止）
    const messageKey = `${message.id}_${message.channelId}`;
    if (processedMessages.has(messageKey)) {
        return;
    }
    processedMessages.add(messageKey);

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

        // 3. リマインド機能
        if (message.reference) {
            // 返信メッセージの場合
            const content = message.content.trim();
            if (content === 'リマインド') {
                try {
                    // 返信元のメッセージを取得
                    const repliedMessage = await message.channel.messages.fetch(message.reference.messageId);

                    // 日付を抽出
                    const reminderService = (await import('../services/reminderService.js')).default;
                    const remindDate = await reminderService.extractDate(
                        repliedMessage.content,
                        repliedMessage.createdAt
                    );

                    if (remindDate) {
                        // リマインドを作成
                        await reminderService.createReminder({
                            guildId: message.guild.id,
                            channelId: message.channel.id,
                            messageId: repliedMessage.id,
                            originalContent: repliedMessage.content,
                            remindAt: remindDate.toISOString(),
                            userId: message.author.id
                        });

                        const dateStr = remindDate.toLocaleString('ja-JP', {
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit'
                        });

                        await message.reply({
                            content: `✅ リマインドを設定しました\n📅 日時: ${dateStr}`,
                            allowedMentions: { repliedUser: false }
                        });
                        logger.info(`リマインド設定: ${message.author.tag} -> ${dateStr}`);
                    } else {
                        await message.reply({
                            content: '❌ メッセージから日付を特定できませんでした。',
                            allowedMentions: { repliedUser: false }
                        });
                    }
                } catch (error) {
                    logger.error('リマインド設定エラー:', error);
                    await message.reply({
                        content: '❌ リマインドの設定に失敗しました。',
                        allowedMentions: { repliedUser: false }
                    });
                }
            }
        }

        // 4. ゲームチャンネルでの自動ロール付与
        if (config.get('features.autoRole.enabled')) {
            await roleManager.assignRoleByChannel(message.member, message.channel);
        }

    } catch (error) {
        logger.error('メッセージ処理エラー:', error);
    }
}

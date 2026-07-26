import recruitmentDetector from '../services/recruitmentDetector.js';
import roleManager from '../services/roleManager.js';
import config from '../config/configLoader.js';
import logger from '../utils/logger.js';

// 処理済みメッセージのキャッシュ（重複防止）
const processedMessages = new Set();
const CACHE_CLEANUP_INTERVAL = 60 * 60 * 1000; // 1時間ごとにクリーンアップ
const CACHE_MAX_SIZE = 10000; // 最大キャッシュサイズ
const DEFAULT_GAME_CATEGORY_NAME = 'ゲームチャンネル';
const DEFAULT_GENERAL_RECRUITMENT_CHANNEL_NAME = '汎用募集チャンネル';

function getRecruitmentChannelType(channel) {
    if (channel.isThread?.()) {
        return null;
    }

    const generalChannelName = config.get('features.recruitmentDetection.generalChannelName')
        || DEFAULT_GENERAL_RECRUITMENT_CHANNEL_NAME;
    if (channel.name === generalChannelName) {
        return 'general';
    }

    const gameCategoryName = config.get('features.autoRole.gameCategoryName')
        || DEFAULT_GAME_CATEGORY_NAME;
    return channel.parent?.name === gameCategoryName ? 'game' : null;
}

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
        const recruitmentChannelType = getRecruitmentChannelType(message.channel);
        if (
            config.get('features.recruitmentDetection.enabled')
            && recruitmentChannelType
        ) {
            const detection = await recruitmentDetector.detect(message.content, message.channel);

            if (detection.isRecruitment) {
                const isGeneralRecruitment = recruitmentChannelType === 'general';
                const role = isGeneralRecruitment
                    ? null
                    : message.guild?.roles.cache.find(r => r.name === message.channel.name);
                const mention = isGeneralRecruitment
                    ? '@everyone'
                    : (role ? `<@&${role.id}>` : '');
                const content = mention
                    ? `${mention} 募集らしきメッセージが送られていそうですよ？`
                    : '募集らしきメッセージが送られていそうですよ？';

                await message.reply({
                    content: content,
                    allowedMentions: {
                        repliedUser: false,
                        ...(isGeneralRecruitment
                            ? { parse: ['everyone'] }
                            : { roles: role ? [role.id] : [] })
                    }
                });
                logger.info(`募集メッセージ検出: "${message.content.substring(0, 50)}..."`);
            }
        }

        // 3. リマインド機能
        if (message.reference) {
            // 返信メッセージの場合
            const content = message.content.trim();
            if (content === 'リマインド' || content.toLowerCase() === 'remind') {
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

import openaiService from './openaiService.js';
import logger from '../utils/logger.js';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * リマインドサービス
 */
class ReminderService {
    constructor() {
        this.reminders = new Map(); // reminderId -> reminderData
        this.timers = new Map(); // reminderId -> timeout
        this.remindersFilePath = join(__dirname, '..', '..', 'reminders.json');
    }

    /**
     * サービスを初期化
     */
    initialize() {
        // 保存されているリマインドを読み込む
        this.loadReminders();
        logger.info('リマインドサービスを初期化しました');
    }

    /**
     * メッセージから日付を抽出
     * @param {string} messageContent - メッセージ内容
     * @param {Date} messageTimestamp - メッセージの送信日時
     * @returns {Promise<Date|null>} 抽出された日時
     */
    async extractDate(messageContent, messageTimestamp) {
        try {
            const currentTime = messageTimestamp.toISOString();

            const systemPrompt = `あなたは日付抽出の専門家です。メッセージから日付を抽出してください。

現在の日時: ${currentTime}

ルール:
- メッセージに含まれる日付表現（「明日」「来週月曜日」「12/25」など）を認識
- メッセージ送信日時を基準に絶対的な日時を計算
- 時刻の指定がない場合は12:00（正午）とする
- 日付が特定できない場合はnullを返す

JSON形式で以下のように回答してください:
{
  "hasDate": true/false,
  "datetime": "YYYY-MM-DDTHH:mm:ss" または null,
  "reason": "判定理由"
}`;

            const messages = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `メッセージ: "${messageContent}"` }
            ];

            const result = await openaiService.chatJSON(messages);

            if (result.hasDate && result.datetime) {
                const date = new Date(result.datetime);
                logger.info(`日付抽出成功: ${messageContent} -> ${date.toISOString()}`);
                return date;
            }

            logger.info(`日付抽出失敗: ${messageContent}`);
            return null;
        } catch (error) {
            logger.error('日付抽出エラー:', error);
            return null;
        }
    }

    /**
     * リマインドを作成
     * @param {Object} data - リマインドデータ
     */
    async createReminder(data) {
        const reminderId = `${data.guildId}_${data.channelId}_${data.messageId}_${Date.now()}`;

        const reminder = {
            id: reminderId,
            guildId: data.guildId,
            channelId: data.channelId,
            messageId: data.messageId,
            originalContent: data.originalContent,
            remindAt: data.remindAt,
            createdAt: new Date().toISOString(),
            userId: data.userId
        };

        this.reminders.set(reminderId, reminder);
        this.scheduleReminder(reminder);
        this.saveReminders();

        logger.info(`リマインド作成: ${reminderId} at ${data.remindAt}`);
        return reminder;
    }

    /**
     * リマインドをスケジュール
     * @param {Object} reminder - リマインドデータ
     */
    scheduleReminder(reminder) {
        const now = Date.now();
        const remindTime = new Date(reminder.remindAt).getTime();
        const delay = remindTime - now;

        if (delay <= 0) {
            logger.warn(`リマインド時刻が過去です: ${reminder.id}`);
            return;
        }

        // 最大タイムアウト時間を超える場合は後で再スケジュール
        const maxTimeout = 2147483647; // 約24.8日
        const actualDelay = Math.min(delay, maxTimeout);

        const timer = setTimeout(async () => {
            if (delay > maxTimeout) {
                // 再スケジュール
                this.scheduleReminder(reminder);
            } else {
                // リマインド実行
                await this.executeReminder(reminder);
            }
        }, actualDelay);

        this.timers.set(reminder.id, timer);
    }

    /**
     * リマインドを実行
     * @param {Object} reminder - リマインドデータ
     */
    async executeReminder(reminder) {
        try {
            logger.info(`リマインド実行: ${reminder.id}`);

            // グローバルクライアントを取得（bot.jsから設定される想定）
            const client = global.discordClient;
            if (!client) {
                logger.error('Discord clientが見つかりません');
                return;
            }

            const channel = await client.channels.fetch(reminder.channelId);
            if (!channel) {
                logger.error(`チャンネルが見つかりません: ${reminder.channelId}`);
                return;
            }

            const message = await channel.messages.fetch(reminder.messageId);
            if (!message) {
                logger.error(`メッセージが見つかりません: ${reminder.messageId}`);
                return;
            }

            // リマインドメッセージを送信
            await message.reply({
                content: `<@${reminder.userId}> リマインド: ${reminder.originalContent}`,
                allowedMentions: { users: [reminder.userId] }
            });

            // リマインドを削除
            this.reminders.delete(reminder.id);
            this.timers.delete(reminder.id);
            this.saveReminders();

        } catch (error) {
            logger.error('リマインド実行エラー:', error);
        }
    }

    /**
     * リマインドを保存
     */
    saveReminders() {
        try {
            const data = Array.from(this.reminders.values());
            writeFileSync(this.remindersFilePath, JSON.stringify(data, null, 2), 'utf-8');
        } catch (error) {
            logger.error('リマインド保存エラー:', error);
        }
    }

    /**
     * リマインドを読み込む
     */
    loadReminders() {
        try {
            if (!existsSync(this.remindersFilePath)) {
                return;
            }

            const data = JSON.parse(readFileSync(this.remindersFilePath, 'utf-8'));
            data.forEach(reminder => {
                this.reminders.set(reminder.id, reminder);
                this.scheduleReminder(reminder);
            });

            logger.info(`${data.length}件のリマインドを読み込みました`);
        } catch (error) {
            logger.error('リマインド読み込みエラー:', error);
        }
    }
}

export default new ReminderService();

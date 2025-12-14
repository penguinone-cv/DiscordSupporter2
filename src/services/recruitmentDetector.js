import openaiService from './openaiService.js';
import csvLoader from '../utils/csvLoader.js';
import config from '../config/configLoader.js';
import logger from '../utils/logger.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { appendFileSync, existsSync, writeFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 募集メッセージ検出サービス（RAG方式）
 */
class RecruitmentDetector {
    constructor() {
        this.trainingData = [];
        this.contextString = '';
    }

    /**
     * CSVデータを読み込む
     */
    initialize() {
        const csvPath = config.get('features.recruitmentDetection.csvPath');
        if (!csvPath) {
            logger.warn('CSVパスが設定されていません');
            return;
        }

        // 相対パスを絶対パスに変換
        const absolutePath = csvPath.startsWith('.')
            ? join(__dirname, '..', '..', csvPath)
            : csvPath;

        this.trainingData = csvLoader.load(absolutePath);
        this.contextString = csvLoader.formatRecruitmentContext(this.trainingData);

        logger.info('募集メッセージ検出器を初期化しました');
    }

    /**
     * メッセージが募集メッセージかどうかを判定
     * @param {string} message - 判定するメッセージ
     * @param {Channel} channel - メッセージが送信されたチャンネル
     * @returns {Promise<Object>} { isRecruitment: boolean, reason: string }
     */
    async detect(message, channel) {
        try {
            const systemPrompt = `あなたは、Discordのメッセージがゲームやイベントの参加者募集を目的としたメッセージかどうかを判定するAIアシスタントです。

${this.contextString}

上記の例を参考にして、与えられたメッセージが募集メッセージかどうかを判定してください。

判定基準:
- ゲームやイベントへの参加を呼びかけている
- 一緒に何かをする人を探している
- 時間や条件を指定して参加者を募っている

JSON形式で以下のように回答してください:
{
  "isRecruitment": true/false,
  "reason": "判定理由を日本語で簡潔に説明"
}`;

            const messages = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `以下のメッセージを判定してください:\n\n"${message}"` }
            ];

            const result = await openaiService.chatJSON(messages);

            logger.info(`募集判定: "${message}" -> ${result.isRecruitment ? '募集' : '非募集'}`);

            // CSVに結果を記録
            if (result.isRecruitment) {
                this.appendToLog(message, true, result.reason, channel?.name || 'unknown');
            }

            return {
                isRecruitment: result.isRecruitment,
                reason: result.reason
            };
        } catch (error) {
            logger.error('募集メッセージ検出エラー:', error);
            return {
                isRecruitment: false,
                reason: 'エラーが発生したため判定できませんでした'
            };
        }
    }

    /**
     * 検出結果をCSVログに追記
     * @param {string} message - メッセージ内容
     * @param {boolean} isRecruitment - 募集メッセージかどうか
     * @param {string} reason - 判定理由
     * @param {string} channelName - チャンネル名
     */
    appendToLog(message, isRecruitment, reason, channelName) {
        try {
            const logPath = config.get('features.recruitmentDetection.logPath');
            if (!logPath) {
                logger.warn('CSVログパスが設定されていません');
                return;
            }

            // 相対パスを絶対パスに変換
            const absoluteLogPath = logPath.startsWith('.')
                ? join(__dirname, '..', '..', logPath)
                : logPath;

            // ファイルが存在しない場合はヘッダーを作成
            if (!existsSync(absoluteLogPath)) {
                writeFileSync(absoluteLogPath, 'timestamp,channel,message,is_recruitment,reason\n', 'utf-8');
                logger.info(`CSVログファイルを作成しました: ${absoluteLogPath}`);
            }

            // CSVエスケープ処理
            const escapeCsv = (str) => {
                if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                    return `"${str.replace(/"/g, '""')}"`;
                }
                return str;
            };

            const timestamp = new Date().toISOString();
            const line = `${timestamp},${escapeCsv(channelName)},${escapeCsv(message)},${isRecruitment},${escapeCsv(reason)}\n`;

            appendFileSync(absoluteLogPath, line, 'utf-8');
            logger.info(`検出結果をCSVに記録しました: ${absoluteLogPath}`);

        } catch (error) {
            logger.error('CSVログ書き込みエラー:', error);
        }
    }
}

export default new RecruitmentDetector();

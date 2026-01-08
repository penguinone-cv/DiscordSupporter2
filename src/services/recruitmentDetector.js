import openaiService from './openaiService.js';
import csvLoader from '../utils/csvLoader.js';
import config from '../config/configLoader.js';
import logger from '../utils/logger.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { appendFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';

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
        this.reload();
    }

    /**
     * CSVデータを再読み込み（WebUIからの更新時に使用）
     */
    reload() {
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

        // デバッグ: コンテキスト文字列をログ出力
        logger.debug(`RAGコンテキスト:\n${this.contextString}`);
        logger.info(`募集メッセージ検出器を初期化しました (学習データ: ${this.trainingData.length}件)`);
    }

    /**
     * メッセージが募集メッセージかどうかを判定
     * @param {string} message - 判定するメッセージ
     * @param {Channel} channel - メッセージが送信されたチャンネル
     * @returns {Promise<Object>} { isRecruitment: boolean, reason: string }
     */
    async detect(message, channel) {
        try {
            // コンテキストが空の場合は警告
            if (!this.contextString || this.contextString.trim() === '') {
                logger.warn('RAGコンテキストが空です。CSVデータが正しく読み込まれていない可能性があります。');
            }

            const systemPrompt = `あなたは、Discordのメッセージがゲームやイベントの参加者募集を目的としたメッセージかどうかを判定するAIアシスタントです。

${this.contextString}

【重要な判定ルール】
1. 上記の「募集メッセージの例」に含まれるメッセージと同じ、または類似したメッセージは必ず「募集メッセージ」と判定してください
2. 上記の「募集メッセージではない例」に含まれるメッセージと同じ、または類似したメッセージは「募集メッセージではない」と判定してください
3. 例にない新しいメッセージの場合は、以下の判定基準で判断してください:
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

            // デバッグ: 送信するプロンプトをログ出力
            logger.debug(`OpenAIに送信するメッセージ: "${message}"`);

            const result = await openaiService.chatJSON(messages);

            logger.info(`募集判定: "${message}" -> ${result.isRecruitment ? '募集' : '非募集'} (理由: ${result.reason})`);

            // CSVに結果を記録（募集・非募集両方をログ）
            this.appendToLog(message, result.isRecruitment, result.reason, channel?.name || 'unknown');

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

            // ログディレクトリを作成（存在しない場合）
            const logDir = dirname(absoluteLogPath);
            if (!existsSync(logDir)) {

                mkdirSync(logDir, { recursive: true });
                logger.info(`ログディレクトリを作成しました: ${logDir}`);
            }

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

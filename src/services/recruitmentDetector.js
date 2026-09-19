import { classifyRecruitment } from './recruitmentClassifier.js';
import csvLoader from '../utils/csvLoader.js';
import config from '../config/configLoader.js';
import logger from '../utils/logger.js';
import { examplePath } from './recruitmentExamplePath.js';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { appendFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 募集メッセージ検出サービス（検証済みの判定例を使用）
 */
class RecruitmentDetector {
    constructor() {
        this.trainingData = [];
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

        try {
            const records = csvLoader.load(examplePath());
            this.trainingData = records;
            logger.info(`判定例を読み込みました (${records.length}件)`);
            return true;
        } catch (error) {
            logger.error('判定例を更新できません。直前の正常な判定例を維持します:', error.message);
            return false;
        }
    }

    /**
     * メッセージが募集メッセージかどうかを判定
     * @param {string} message - 判定するメッセージ
     * @param {Channel} channel - メッセージが送信されたチャンネル
     * @returns {Promise<Object>} { isRecruitment: boolean, reason: string }
     */
    async detect(message, channel) {
        const provider = config.get('features.recruitmentDetection.provider') ?? 'openai';
        try {
            const result = await classifyRecruitment(provider, message, this.trainingData);
            const reason = provider === 'jev' ? '' : result.reason;
            logger.info(`募集判定 provider=${provider} result=${result.isRecruitment}`);
            this.appendToLog(message, result.isRecruitment, reason, channel?.name || 'unknown');
            return { isRecruitment: result.isRecruitment, reason };
        } catch (error) {
            logger.error(`募集メッセージ検出エラー provider=${provider}:`, error.message);
            // An API failure is not a negative training label: keep it out of detection CSV.
            return {
                isRecruitment: false,
                reason: provider === 'jev' ? '' : 'エラーが発生したため判定できませんでした'
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
            const absoluteLogPath = resolve(__dirname, '..', '..', logPath);

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
                if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
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

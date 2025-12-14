import { readFileSync } from 'fs';
import { parse } from 'csv-parse/sync';
import logger from './logger.js';

/**
 * CSVファイルを読み込んでパースする
 */
class CSVLoader {
    /**
     * CSVファイルを読み込む
     * @param {string} filePath - CSVファイルのパス
     * @returns {Array<Object>} パースされたデータ
     */
    load(filePath) {
        try {
            const fileContent = readFileSync(filePath, 'utf-8');
            const records = parse(fileContent, {
                columns: true,
                skip_empty_lines: true,
                trim: true
            });

            logger.info(`CSV読み込み成功: ${filePath} (${records.length}件)`);
            return records;
        } catch (error) {
            logger.error(`CSV読み込みエラー: ${filePath}`, error);
            return [];
        }
    }

    /**
     * 募集データをRAG用のコンテキスト文字列に変換
     * @param {Array<Object>} records - CSVレコード
     * @returns {string} コンテキスト文字列
     */
    formatRecruitmentContext(records) {
        let context = '以下は募集メッセージの例です:\n\n';
        context += '【募集メッセージの例】\n';

        const recruitmentExamples = records.filter(r => r.is_recruitment === 'true');
        recruitmentExamples.forEach((record, index) => {
            context += `${index + 1}. "${record.message}"\n`;
            context += `   理由: ${record.reason}\n\n`;
        });

        context += '\n【募集メッセージではない例】\n';
        const nonRecruitmentExamples = records.filter(r => r.is_recruitment === 'false');
        nonRecruitmentExamples.forEach((record, index) => {
            context += `${index + 1}. "${record.message}"\n`;
            context += `   理由: ${record.reason}\n\n`;
        });

        return context;
    }
}

export default new CSVLoader();

import express from 'express';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { parse } from 'csv-parse/sync';
import stringify from 'csv-stringify/lib/sync.js';
import config from '../config/configLoader.js';
import logger from '../utils/logger.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * WebUIサーバー
 */
class WebServer {
    constructor() {
        this.app = null;
        this.server = null;
        this.port = 3000;
    }

    /**
     * サーバーを初期化
     */
    initialize() {
        this.app = express();

        // ミドルウェア
        this.app.use(express.json());
        this.app.use(express.static(join(__dirname, '..', '..', 'public')));

        // ルート設定
        this.setupRoutes();

        logger.info('WebUIサーバー初期化完了');
    }

    /**
     * ルート設定
     */
    setupRoutes() {
        // ホームページ
        this.app.get('/', (req, res) => {
            res.sendFile(join(__dirname, '..', '..', 'public', 'index.html'));
        });

        // CSV取得API
        this.app.get('/api/csv', (req, res) => {
            try {
                const csvPath = config.get('features.recruitmentDetection.csvPath');
                const absolutePath = csvPath.startsWith('.')
                    ? join(__dirname, '..', '..', csvPath)
                    : csvPath;

                const fileContent = readFileSync(absolutePath, 'utf-8');
                const records = parse(fileContent, {
                    columns: true,
                    skip_empty_lines: true,
                    trim: true
                });

                res.json({
                    success: true,
                    data: records
                });
            } catch (error) {
                logger.error('CSV読み込みエラー:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // CSV保存API
        this.app.post('/api/csv', async (req, res) => {
            try {
                const { data } = req.body;

                if (!Array.isArray(data)) {
                    return res.status(400).json({
                        success: false,
                        error: 'データが配列ではありません'
                    });
                }

                // CSVに変換
                const csvContent = stringify(data, {
                    header: true,
                    columns: ['message', 'is_recruitment', 'reason']
                });

                const csvPath = config.get('features.recruitmentDetection.csvPath');
                const absolutePath = csvPath.startsWith('.')
                    ? join(__dirname, '..', '..', csvPath)
                    : csvPath;

                writeFileSync(absolutePath, csvContent, 'utf-8');
                logger.info('CSVファイルを更新しました');

                // RAGデータを再読み込み（Bot再起動なしで反映）
                const recruitmentDetector = (await import('./recruitmentDetector.js')).default;
                recruitmentDetector.reload();
                logger.info('RAGデータを再読み込みしました');

                res.json({
                    success: true,
                    message: 'CSVファイルを保存し、RAGデータを更新しました'
                });
            } catch (error) {
                logger.error('CSV保存エラー:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // ヘルスチェック
        this.app.get('/api/health', (req, res) => {
            res.json({ status: 'ok' });
        });

        // ログ取得API
        this.app.get('/api/logs', async (req, res) => {
            try {
                const logPath = config.get('features.recruitmentDetection.logPath');
                if (!logPath) {
                    return res.json({
                        success: true,
                        data: []
                    });
                }

                const absolutePath = logPath.startsWith('.')
                    ? join(__dirname, '..', '..', logPath)
                    : logPath;

                // ファイルが存在しない場合は空配列を返す
                if (!existsSync(absolutePath)) {
                    return res.json({
                        success: true,
                        data: []
                    });
                }

                const fileContent = readFileSync(absolutePath, 'utf-8');
                const records = parse(fileContent, {
                    columns: true,
                    skip_empty_lines: true,
                    trim: true
                });

                // 最新のログを先頭にする（逆順）
                const sortedRecords = records.reverse();

                res.json({
                    success: true,
                    data: sortedRecords
                });
            } catch (error) {
                logger.error('ログ読み込みエラー:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });
    }

    /**
     * サーバーを起動
     */
    start() {
        const port = config.get('webui.port') || this.port;
        const host = config.get('webui.host') || '0.0.0.0';

        this.server = this.app.listen(port, host, () => {
            logger.info(`🌐 WebUIサーバーが起動しました: http://${host}:${port}`);
        });
    }

    /**
     * サーバーを停止
     */
    stop() {
        if (this.server) {
            this.server.close();
            logger.info('WebUIサーバーを停止しました');
        }
    }
}

export default new WebServer();

import express from 'express';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { parse } from 'csv-parse/sync';
import stringify from 'csv-stringify/lib/sync.js';
import config from '../config/configLoader.js';
import logger from '../utils/logger.js';
import reminderService from './reminderService.js';
import { createActivityScheduleRouter } from '../routes/activityScheduleRouter.js';
import { ActivityAuthService } from './activityAuthService.js';
import { ActivitySessionService } from './activitySessionService.js';
import activityScheduleService from './activityScheduleService.js';
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
    initialize({ discordClient = global.discordClient } = {}) {
        this.app = express();

        const activityEnabled = config.get('activity.enabled') === true;
        const sessionService = activityEnabled ? new ActivitySessionService({
            secret: config.get('activity.sessionSecret'),
            ttlSeconds: config.get('activity.sessionTtlSeconds') ?? 300
        }) : null;
        const authService = activityEnabled ? new ActivityAuthService({
            clientId: config.get('discord.clientId'),
            clientSecret: config.get('discord.clientSecret'),
            botToken: config.get('discord.token'),
            discordClient,
            sessionService
        }) : null;
        // Mount before the legacy JSON parser so the Activity size limit and error boundary apply.
        this.app.use('/api/activity/schedule', createActivityScheduleRouter({
            enabled: activityEnabled, clientId: config.get('discord.clientId'),
            authService, sessionService, scheduleService: activityScheduleService
        }));
        this.app.use('/schedule', (_req, res, next) => {
            res.set({
                'Cache-Control': 'no-cache',
                'X-Content-Type-Options': 'nosniff',
                'Referrer-Policy': 'no-referrer',
                'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors https://discord.com https://*.discord.com https://*.discordsays.com"
            });
            next();
        });
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

        // カレンダーページ
        this.app.get('/calendar', (req, res) => {
            res.sendFile(join(__dirname, '..', '..', 'public', 'calendar.html'));
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

        // リマインド一覧取得API（カレンダー用に予定データを返す）
        this.app.get('/api/reminders', async (req, res) => {
            try {
                const reminders = reminderService.getCalendarEvents();
                const channelActivity = reminderService.getChannelActivity();
                const client = global.discordClient;

                // チャンネル名を解決
                const enrichedReminders = [];
                for (const reminder of reminders) {
                    let channelName = '不明';
                    // まずキャッシュから取得
                    if (channelActivity[reminder.channelId]) {
                        channelName = channelActivity[reminder.channelId].channelName;
                    } else if (client) {
                        // キャッシュにない場合はDiscord APIから取得し、キャッシュを生成・保存
                        try {
                            await reminderService.updateChannelActivity(reminder.channelId, reminder.guildId);
                            const updated = reminderService.getChannelActivity();
                            if (updated[reminder.channelId]) {
                                channelName = updated[reminder.channelId].channelName;
                            }
                        } catch (e) {
                            logger.warn(`チャンネル名解決失敗: ${reminder.channelId}`);
                        }
                    }

                    enrichedReminders.push({
                        ...reminder,
                        channelName
                    });
                }

                // チャンネル一覧を構築（全チャンネル + 最終更新日時順）
                const latestActivity = reminderService.getChannelActivity();
                const channelMap = new Map();

                // リマインドがあるチャンネルを追加
                for (const reminder of enrichedReminders) {
                    if (!channelMap.has(reminder.channelId)) {
                        const activity = latestActivity[reminder.channelId];
                        channelMap.set(reminder.channelId, {
                            id: reminder.channelId,
                            name: reminder.channelName,
                            lastActivityAt: activity ? activity.lastActivityAt : reminder.createdAt
                        });
                    }
                }

                // Discord APIから全テキストチャンネルを取得して追加
                if (client) {
                    for (const [, guild] of client.guilds.cache) {
                        for (const [, channel] of guild.channels.cache) {
                            if (channel.isTextBased() && !channel.isThread() && !channelMap.has(channel.id)) {
                                channelMap.set(channel.id, {
                                    id: channel.id,
                                    name: channel.name,
                                    lastActivityAt: latestActivity[channel.id]
                                        ? latestActivity[channel.id].lastActivityAt
                                        : '1970-01-01T00:00:00.000Z'
                                });
                            }
                        }
                    }
                }

                // 最終更新日時順でソート（降順）
                const channels = Array.from(channelMap.values())
                    .sort((a, b) => new Date(b.lastActivityAt) - new Date(a.lastActivityAt));

                res.json({
                    success: true,
                    data: enrichedReminders,
                    channels
                });
            } catch (error) {
                logger.error('リマインド取得エラー:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // メンバータグ横断取得API
        this.app.get('/api/reminders/related', async (req, res) => {
            try {
                const { channelName } = req.query;
                if (!channelName) {
                    return res.status(400).json({
                        success: false,
                        error: 'channelNameパラメータが必要です'
                    });
                }

                const client = global.discordClient;
                if (!client) {
                    return res.json({
                        success: true,
                        members: []
                    });
                }

                const reminders = reminderService.getCalendarEvents();
                const channelActivity = reminderService.getChannelActivity();
                const members = [];

                // 全ギルドを走査
                for (const [, guild] of client.guilds.cache) {
                    // チャンネル名と同名のロールを検索
                    const role = guild.roles.cache.find(r => r.name === channelName);
                    if (!role) continue;

                    // GuildMembers Intentで維持されるキャッシュを使う。
                    // チャンネル選択のたびに全メンバー取得を送らない。
                    for (const [, member] of role.members) {
                        if (member.user.bot) continue;

                        // このメンバーの他のロール名を取得
                        const otherRoleNames = member.roles.cache
                            .filter(r => r.name !== channelName && r.name !== '@everyone')
                            .map(r => r.name);

                        // 他のロール名に対応するリマインドを検索
                        const relatedReminders = [];
                        for (const roleName of otherRoleNames) {
                            // channelActivityからロール名に一致するチャンネルを検索
                            const matchingChannelIds = Object.entries(channelActivity)
                                .filter(([, info]) => info.channelName === roleName)
                                .map(([id]) => id);

                            // 一致するリマインドを検索
                            for (const reminder of reminders) {
                                if (matchingChannelIds.includes(reminder.channelId)) {
                                    relatedReminders.push({
                                        channelName: roleName,
                                        remindAt: reminder.remindAt,
                                        content: reminder.originalContent
                                    });
                                }
                            }
                        }

                        if (relatedReminders.length > 0) {
                            members.push({
                                name: member.displayName,
                                avatar: member.user.displayAvatarURL({ size: 32 }),
                                relatedReminders
                            });
                        }
                    }
                }

                res.json({
                    success: true,
                    members
                });
            } catch (error) {
                logger.error('関連リマインド取得エラー:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
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

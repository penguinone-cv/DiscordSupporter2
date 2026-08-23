import { Client, GatewayIntentBits, Partials, REST, Routes } from 'discord.js';
import config from './config/configLoader.js';
import openaiService from './services/openaiService.js';
import recruitmentDetector from './services/recruitmentDetector.js';
import roleManager from './services/roleManager.js';
import reminderService from './services/reminderService.js';
import webServer from './services/webServer.js';
import handleMessage from './handlers/messageHandler.js';
import handleReactionAdd, { handleReactionRemove } from './handlers/reactionHandler.js';
import handleInteraction from './handlers/interactionHandler.js';
import handleChannelCreate from './handlers/channelCreateHandler.js';
import handleChannelUpdate from './handlers/channelUpdateHandler.js';
import handleChannelDelete from './handlers/channelDeleteHandler.js';
import voteCommand from './commands/vote.js';
import gameAdminCommand from './commands/gameAdmin.js';
import database from './repositories/database.js';
import archiveRepository from './repositories/archiveRepository.js';
import gameRegistryService from './services/gameRegistryService.js';
import channelActivityService from './services/channelActivityService.js';
import gameAdminPanelService from './services/gameAdminPanelService.js';
import gameMemberPanelService from './services/gameMemberPanelService.js';
import gameReturnRequestService from './services/gameReturnRequestService.js';
import scheduleService from './services/scheduleService.js';
import maintenanceService from './services/maintenanceService.js';
import logger from './utils/logger.js';

/**
 * Discord Botの初期化と起動
 */
class Bot {
    constructor() {
        this.client = null;
    }

    /**
     * Botを初期化
     */
    async initialize() {
        // 設定を読み込み
        config.load();

        // 永続データを準備してからDiscordへ接続する
        database.initialize(config.get('database.path') || './data/discord-supporter.db');

        // Discord Clientを作成
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.GuildMessageReactions,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildMembers
            ],
            partials: [
                Partials.Message,
                Partials.Channel,
                Partials.Reaction
            ]
        });

        // サービスを初期化
        openaiService.initialize();
        recruitmentDetector.initialize();
        roleManager.initialize();
        await reminderService.initialize();

        // グローバルクライアント参照を設定（リマインド実行用）
        global.discordClient = this.client;

        // WebUIサーバーを初期化（有効な場合のみ）
        if (config.get('webui.enabled')) {
            webServer.initialize();
        }

        // イベントハンドラーを登録
        this.registerEventHandlers();

        // スラッシュコマンドを登録
        await this.registerSlashCommands();

        logger.info('Bot初期化完了');
    }

    /**
     * イベントハンドラーを登録
     */
    registerEventHandlers() {
        // Bot準備完了
        this.client.once('ready', async () => {
            logger.info(`✅ ${this.client.user.tag} でログインしました`);
            logger.info(`サーバー数: ${this.client.guilds.cache.size}`);
            try {
                const interrupted = archiveRepository.markInterruptedOperations();
                if (interrupted) logger.warn(`${interrupted}件の中断操作を要確認状態へ移しました`);
                await gameRegistryService.reconcileAll(this.client);
                // 活動履歴の走査は起動を妨げないよう、ready後に順次実行する
                channelActivityService.reconcileAll(this.client)
                    .then(async () => {
                        for (const guild of this.client.guilds.cache.values()) {
                            scheduleService.ensureCurrentAndNext(guild.id);
                            await gameAdminPanelService.refreshPanel(guild);
                            await gameMemberPanelService.refreshPanel(guild);
                            await gameReturnRequestService.reconcileGuild(guild);
                        }
                    })
                    .catch(error => logger.error('起動時活動整合エラー:', error));
                maintenanceService.start(this.client);
            } catch (error) {
                logger.error('起動時ゲーム管理同期エラー:', error);
            }
        });

        // メッセージ作成
        this.client.on('messageCreate', handleMessage);

        // リアクション追加
        this.client.on('messageReactionAdd', handleReactionAdd);
        this.client.on('messageReactionRemove', handleReactionRemove);

        // チャンネル作成
        this.client.on('channelCreate', handleChannelCreate);

        // チャンネル更新・削除
        this.client.on('channelUpdate', handleChannelUpdate);
        this.client.on('channelDelete', handleChannelDelete);

        // インタラクション（スラッシュコマンド、ボタンなど）
        this.client.on('interactionCreate', handleInteraction);

        // エラーハンドリング
        this.client.on('error', (error) => {
            logger.error('Discord Clientエラー:', error);
        });
    }

    /**
     * スラッシュコマンドをDiscordに登録
     */
    async registerSlashCommands() {
        const commands = [
            voteCommand.data.toJSON(),
            gameAdminCommand.data.toJSON()
        ];

        const rest = new REST({ version: '10' }).setToken(config.get('discord.token'));

        try {
            logger.info('スラッシュコマンドを登録中...');

            const clientId = config.get('discord.clientId');

            // グローバルにコマンドを登録
            await rest.put(
                Routes.applicationCommands(clientId),
                { body: commands }
            );

            logger.info(`✅ ${commands.length}個のスラッシュコマンドを登録しました`);
        } catch (error) {
            logger.error('スラッシュコマンド登録エラー:', error);
        }
    }

    /**
   * Botを起動
   */
    async start() {
        const token = config.get('discord.token');
        await this.client.login(token);

        // WebUIサーバーを起動（有効な場合のみ）
        if (config.get('webui.enabled')) {
            webServer.start();
        }
    }

    async stop() {
        maintenanceService.stop();
        webServer.stop();
        this.client?.destroy();
        database.close();
    }
}

export default Bot;

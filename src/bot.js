import { Client, GatewayIntentBits, Partials, REST, Routes } from 'discord.js';
import config from './config/configLoader.js';
import openaiService from './services/openaiService.js';
import recruitmentDetector from './services/recruitmentDetector.js';
import roleManager from './services/roleManager.js';
import handleMessage from './handlers/messageHandler.js';
import handleReactionAdd from './handlers/reactionHandler.js';
import handleInteraction from './handlers/interactionHandler.js';
import voteCommand from './commands/vote.js';
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
        this.client.once('ready', () => {
            logger.info(`✅ ${this.client.user.tag} でログインしました`);
            logger.info(`サーバー数: ${this.client.guilds.cache.size}`);
        });

        // メッセージ作成
        this.client.on('messageCreate', handleMessage);

        // リアクション追加
        this.client.on('messageReactionAdd', handleReactionAdd);

        // インタラクション（スラッシュコマンド、ボタンなど）
        this.client.on('interactionCreate', async (interaction) => {
            // ボタンインタラクション
            if (interaction.isButton() && interaction.customId.startsWith('vote_')) {
                await voteCommand.handleButton(interaction);
            }
            // スラッシュコマンド
            else if (interaction.isChatInputCommand()) {
                await handleInteraction(interaction);
            }
        });

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
            voteCommand.data.toJSON()
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
    }
}

export default Bot;

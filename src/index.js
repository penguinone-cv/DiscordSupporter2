import Bot from './bot.js';
import logger from './utils/logger.js';

/**
 * アプリケーションのエントリーポイント
 */
async function main() {
    let bot;
    try {
        logger.info('Discord Supporter Bot を起動しています...');

        bot = new Bot();
        await bot.initialize();
        await bot.start();

        const shutdown = async (signal) => {
            logger.info(`${signal}を受信したため終了します`);
            await bot.stop();
            process.exit(0);
        };
        process.once('SIGINT', () => shutdown('SIGINT'));
        process.once('SIGTERM', () => shutdown('SIGTERM'));

    } catch (error) {
        logger.error('起動エラー:', error);
        process.exit(1);
    }
}

// プロセス終了時のハンドリング
process.on('unhandledRejection', (error) => {
    logger.error('未処理のPromise拒否:', error);
});

process.on('uncaughtException', (error) => {
    logger.error('未処理の例外:', error);
    process.exit(1);
});

// アプリケーションを起動
main();

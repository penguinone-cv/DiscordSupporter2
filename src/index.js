import Bot from './bot.js';
import logger from './utils/logger.js';

/**
 * アプリケーションのエントリーポイント
 */
async function main() {
    try {
        logger.info('Discord Supporter Bot を起動しています...');

        const bot = new Bot();
        await bot.initialize();
        await bot.start();

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

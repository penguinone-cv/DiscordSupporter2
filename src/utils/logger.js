/**
 * シンプルなロガーユーティリティ
 */
class Logger {
    /**
     * 情報ログ
     * @param {string} message 
     * @param  {...any} args 
     */
    info(message, ...args) {
        console.log(`[INFO] ${new Date().toISOString()} - ${message}`, ...args);
    }

    /**
     * エラーログ
     * @param {string} message 
     * @param  {...any} args 
     */
    error(message, ...args) {
        console.error(`[ERROR] ${new Date().toISOString()} - ${message}`, ...args);
    }

    /**
     * 警告ログ
     * @param {string} message 
     * @param  {...any} args 
     */
    warn(message, ...args) {
        console.warn(`[WARN] ${new Date().toISOString()} - ${message}`, ...args);
    }

    /**
     * デバッグログ
     * @param {string} message 
     * @param  {...any} args 
     */
    debug(message, ...args) {
        if (process.env.DEBUG) {
            console.debug(`[DEBUG] ${new Date().toISOString()} - ${message}`, ...args);
        }
    }
}

export default new Logger();

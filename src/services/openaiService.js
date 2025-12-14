import OpenAI from 'openai';
import config from '../config/configLoader.js';
import logger from '../utils/logger.js';

/**
 * OpenAI APIサービス
 */
class OpenAIService {
    constructor() {
        this.client = null;
        this.model = null;
    }

    /**
     * OpenAIクライアントを初期化
     */
    initialize() {
        const apiKey = config.get('openai.apiKey');
        this.model = config.get('openai.model') || 'gpt-4o-mini';

        this.client = new OpenAI({
            apiKey: apiKey
        });

        logger.info(`OpenAI初期化完了 (モデル: ${this.model})`);
    }

    /**
     * チャット補完APIを呼び出す
     * @param {Array} messages - メッセージ配列
     * @param {Object} options - オプション
     * @returns {Promise<string>} AIの応答
     */
    async chat(messages, options = {}) {
        try {
            const response = await this.client.chat.completions.create({
                model: this.model,
                messages: messages,
                temperature: options.temperature || 0.3,
                max_tokens: options.maxTokens || 500,
                ...options
            });

            return response.choices[0].message.content;
        } catch (error) {
            logger.error('OpenAI APIエラー:', error);
            throw error;
        }
    }

    /**
     * 構造化された応答を取得（JSON形式）
     * @param {Array} messages - メッセージ配列
     * @returns {Promise<Object>} パースされたJSON
     */
    async chatJSON(messages) {
        try {
            const response = await this.client.chat.completions.create({
                model: this.model,
                messages: messages,
                temperature: 0.3,
                response_format: { type: "json_object" }
            });

            const content = response.choices[0].message.content;
            return JSON.parse(content);
        } catch (error) {
            logger.error('OpenAI JSON APIエラー:', error);
            throw error;
        }
    }
}

export default new OpenAIService();

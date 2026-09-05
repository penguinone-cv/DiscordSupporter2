import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 設定ファイルを読み込み、バリデーションを行う
 */
class ConfigLoader {
  constructor() {
    this.config = null;
  }

  /**
   * config.jsonを読み込む
   * @returns {Object} 設定オブジェクト
   */
  load() {
    try {
      const configPath = join(__dirname, '..', '..', 'config.json');
      const configData = readFileSync(configPath, 'utf-8');
      this.config = JSON.parse(configData);
      
      this.validate();
      
      console.log('✅ 設定ファイルを正常に読み込みました');
      return this.config;
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.error('❌ config.jsonが見つかりません。config.example.jsonをコピーしてconfig.jsonを作成してください。');
      } else {
        console.error('❌ 設定ファイルの読み込みに失敗しました:', error.message);
      }
      process.exit(1);
    }
  }

  /**
   * 設定のバリデーション
   */
  validate() {
    const required = [
      'discord.token',
      'discord.clientId',
      'openai.apiKey'
    ];

    for (const key of required) {
      const keys = key.split('.');
      let value = this.config;
      
      for (const k of keys) {
        value = value?.[k];
      }

      if (!value || value.includes('YOUR_')) {
        throw new Error(`必須項目 "${key}" が設定されていません`);
      }
    }

    if (this.get('activity.enabled') === true) {
      if (this.get('webui.enabled') !== true) {
        throw new Error('Activityを利用するには "webui.enabled" を true にしてください');
      }

      for (const [key, minLength] of [
        ['discord.clientSecret', 1],
        ['activity.sessionSecret', 32]
      ]) {
        const value = this.get(key);
        if (typeof value !== 'string' || value.trim().length < minLength || value.includes('YOUR_')) {
          throw new Error(`Activityの必須項目 "${key}" に ${minLength} 文字以上の有効な文字列を設定してください`);
        }
      }

      const configuredTtl = this.get('activity.sessionTtlSeconds');
      const ttl = configuredTtl === undefined ? 300 : configuredTtl;
      if (!Number.isInteger(ttl) || ttl < 30 || ttl > 3600) {
        throw new Error('"activity.sessionTtlSeconds" は 30 以上 3600 以下の整数で指定してください');
      }
      this.config.activity.sessionTtlSeconds = ttl;
    }
  }

  /**
   * 設定値を取得
   * @param {string} path - ドット区切りのパス (例: 'discord.token')
   * @returns {*} 設定値
   */
  get(path) {
    const keys = path.split('.');
    let value = this.config;
    
    for (const key of keys) {
      value = value?.[key];
    }
    
    return value;
  }
}

export default new ConfigLoader();

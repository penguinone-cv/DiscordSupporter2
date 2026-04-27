import { describe, it, expect, vi, beforeEach } from 'vitest';

// configLoader はシングルトンでexportされており、内部で fs.readFileSync を使っている。
// テストでは内部状態を直接操作してバリデーションとgetter をテストする。

// モジュールの内部依存をモック
vi.mock('fs', () => ({
    readFileSync: vi.fn(),
}));

// ConfigLoader クラスを直接テストするため、モジュールをインポート
// シングルトンのため、各テストで状態をリセットする
let configLoader;

beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../src/config/configLoader.js');
    configLoader = mod.default;
});

describe('ConfigLoader', () => {
    describe('get()', () => {
        it('ドット区切りパスで正しい値を返す', () => {
            configLoader.config = {
                discord: { token: 'test-token', clientId: 'test-client-id' },
                openai: { apiKey: 'test-key' },
            };

            expect(configLoader.get('discord.token')).toBe('test-token');
            expect(configLoader.get('discord.clientId')).toBe('test-client-id');
            expect(configLoader.get('openai.apiKey')).toBe('test-key');
        });

        it('ネストされたオブジェクトの深い階層にアクセスできる', () => {
            configLoader.config = {
                features: {
                    recruitmentDetection: { enabled: true, csvPath: './data.csv' },
                },
            };

            expect(configLoader.get('features.recruitmentDetection.enabled')).toBe(true);
            expect(configLoader.get('features.recruitmentDetection.csvPath')).toBe('./data.csv');
        });

        it('存在しないパスで undefined を返す', () => {
            configLoader.config = { discord: { token: 'test' } };

            expect(configLoader.get('nonexistent')).toBeUndefined();
            expect(configLoader.get('discord.nonexistent')).toBeUndefined();
            expect(configLoader.get('a.b.c.d')).toBeUndefined();
        });

        it('config が null の場合 undefined を返す', () => {
            configLoader.config = null;

            expect(configLoader.get('discord.token')).toBeUndefined();
        });
    });

    describe('validate()', () => {
        it('正常な設定でエラーを投げない', () => {
            configLoader.config = {
                discord: { token: 'real-token', clientId: 'real-client-id' },
                openai: { apiKey: 'real-api-key' },
            };

            expect(() => configLoader.validate()).not.toThrow();
        });

        it('discord.token が未設定の場合エラーを投げる', () => {
            configLoader.config = {
                discord: { token: '', clientId: 'real-client-id' },
                openai: { apiKey: 'real-api-key' },
            };

            expect(() => configLoader.validate()).toThrow('必須項目 "discord.token" が設定されていません');
        });

        it('discord.clientId が未設定の場合エラーを投げる', () => {
            configLoader.config = {
                discord: { token: 'real-token', clientId: '' },
                openai: { apiKey: 'real-api-key' },
            };

            expect(() => configLoader.validate()).toThrow('必須項目 "discord.clientId" が設定されていません');
        });

        it('openai.apiKey が未設定の場合エラーを投げる', () => {
            configLoader.config = {
                discord: { token: 'real-token', clientId: 'real-client-id' },
                openai: { apiKey: '' },
            };

            expect(() => configLoader.validate()).toThrow('必須項目 "openai.apiKey" が設定されていません');
        });

        it('YOUR_ を含む値の場合エラーを投げる', () => {
            configLoader.config = {
                discord: { token: 'YOUR_DISCORD_TOKEN', clientId: 'real-client-id' },
                openai: { apiKey: 'real-api-key' },
            };

            expect(() => configLoader.validate()).toThrow('必須項目 "discord.token" が設定されていません');
        });

        it('キーが完全に存在しない場合エラーを投げる', () => {
            configLoader.config = {
                discord: { token: 'real-token' },
                // clientId が存在しない
                openai: { apiKey: 'real-api-key' },
            };

            expect(() => configLoader.validate()).toThrow('必須項目 "discord.clientId" が設定されていません');
        });
    });
});

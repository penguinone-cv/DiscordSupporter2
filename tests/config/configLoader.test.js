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

        describe('Activity設定', () => {
            beforeEach(() => {
                configLoader.config = {
                    discord: {
                        token: 'real-token', clientId: 'real-client-id',
                        clientSecret: 'real-client-secret'
                    },
                    openai: { apiKey: 'real-api-key' },
                    webui: { enabled: true },
                    activity: { enabled: true, sessionSecret: 's'.repeat(32) }
                };
            });

            it('有効な設定では任意のセッション有効期間を300秒に補う', () => {
                expect(() => configLoader.validate()).not.toThrow();
                expect(configLoader.get('activity.sessionTtlSeconds')).toBe(300);
            });

            it.each([30, 300, 3600])('セッション有効期間%d秒を受け付ける', value => {
                configLoader.config.activity.sessionTtlSeconds = value;
                expect(() => configLoader.validate()).not.toThrow();
                expect(configLoader.get('activity.sessionTtlSeconds')).toBe(value);
            });

            it.each([undefined, false, 'true'])('WebUIが明示的に有効でない場合を拒否する: %s', enabled => {
                configLoader.config.webui.enabled = enabled;
                expect(() => configLoader.validate()).toThrow('webui.enabled');
            });

            it('WebUI設定がない場合を拒否する', () => {
                delete configLoader.config.webui;
                expect(() => configLoader.validate()).toThrow('webui.enabled');
            });

            it.each([undefined, '', '   ', 'YOUR_DISCORD_CLIENT_SECRET_HERE', 123, {}])(
                '無効なDiscordシークレットを拒否する: %j', value => {
                    configLoader.config.discord.clientSecret = value;
                    expect(() => configLoader.validate()).toThrow('discord.clientSecret');
                }
            );

            it.each([undefined, '', ' '.repeat(32), 's'.repeat(31), 'YOUR_RANDOM_SESSION_SECRET_HERE_32', 123, {}])(
                '無効なセッションシークレットを拒否する: %j', value => {
                    configLoader.config.activity.sessionSecret = value;
                    expect(() => configLoader.validate()).toThrow('activity.sessionSecret');
                }
            );

            it.each([null, 29, 3601, 30.5, '300', true])('無効な有効期間を拒否する: %j', value => {
                configLoader.config.activity.sessionTtlSeconds = value;
                expect(() => configLoader.validate()).toThrow('activity.sessionTtlSeconds');
            });

            it('無効化時はシークレット未設定・不正な追加設定でも旧設定との互換を保つ', () => {
                configLoader.config.activity = { enabled: false, sessionTtlSeconds: 1 };
                delete configLoader.config.discord.clientSecret;
                delete configLoader.config.webui;
                expect(() => configLoader.validate()).not.toThrow();
            });

            it('Activity設定がない旧設定を変更しない', () => {
                delete configLoader.config.activity;
                delete configLoader.config.discord.clientSecret;
                delete configLoader.config.webui;
                expect(() => configLoader.validate()).not.toThrow();
                expect(configLoader.get('activity')).toBeUndefined();
            });
        });
    });
});

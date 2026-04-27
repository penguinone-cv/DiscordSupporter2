import { describe, it, expect, vi, beforeEach } from 'vitest';

// 依存モジュールをモック
vi.mock('../../src/utils/logger.js', () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    },
}));

vi.mock('../../src/config/configLoader.js', () => ({
    default: {
        get: vi.fn(),
    },
}));

let RoleManager;
let config;

beforeEach(async () => {
    vi.resetModules();

    const configMod = await import('../../src/config/configLoader.js');
    config = configMod.default;

    // RoleManager はシングルトンなので、クラスを直接テスト可能にする
    // resetModules で毎回新しいインスタンスを取得
    const mod = await import('../../src/services/roleManager.js');
    RoleManager = mod.default;
});

describe('RoleManager', () => {
    describe('initialize()', () => {
        it('config からカテゴリ名を取得して設定する', () => {
            config.get.mockReturnValue('テストカテゴリ');
            RoleManager.initialize();

            expect(RoleManager.gameCategoryName).toBe('テストカテゴリ');
        });

        it('config が未設定の場合デフォルト値を使う', () => {
            config.get.mockReturnValue(undefined);
            RoleManager.initialize();

            expect(RoleManager.gameCategoryName).toBe('ゲームチャンネル');
        });
    });

    describe('isGameChannel()', () => {
        beforeEach(() => {
            RoleManager.gameCategoryName = 'ゲームチャンネル';
        });

        it('ゲームカテゴリのチャンネルで true を返す', () => {
            const channel = { parent: { name: 'ゲームチャンネル' } };
            expect(RoleManager.isGameChannel(channel)).toBe(true);
        });

        it('異なるカテゴリのチャンネルで false を返す', () => {
            const channel = { parent: { name: '一般チャンネル' } };
            expect(RoleManager.isGameChannel(channel)).toBe(false);
        });

        it('親カテゴリがない場合 false を返す', () => {
            const channel = { parent: null };
            expect(RoleManager.isGameChannel(channel)).toBe(false);
        });
    });

    describe('assignRoleByChannel()', () => {
        beforeEach(() => {
            RoleManager.gameCategoryName = 'ゲームチャンネル';
        });

        it('非ゲームチャンネルでは何もしない', async () => {
            const member = { roles: { cache: new Map(), add: vi.fn() } };
            const channel = {
                name: 'apex',
                parent: { name: '一般カテゴリ' },
                guild: { roles: { cache: { find: vi.fn() } } },
            };

            await RoleManager.assignRoleByChannel(member, channel);

            expect(member.roles.add).not.toHaveBeenCalled();
        });

        it('ゲームチャンネルで既存ロールを付与する', async () => {
            const mockRole = { id: 'role-123', name: 'apex' };
            const memberRolesCache = new Map();
            const member = {
                roles: {
                    cache: { has: vi.fn().mockReturnValue(false) },
                    add: vi.fn(),
                },
                user: { tag: 'TestUser#1234' },
            };
            const channel = {
                name: 'apex',
                parent: { name: 'ゲームチャンネル' },
                guild: {
                    roles: {
                        cache: { find: vi.fn().mockReturnValue(mockRole) },
                        create: vi.fn(),
                    },
                },
            };

            await RoleManager.assignRoleByChannel(member, channel);

            expect(member.roles.add).toHaveBeenCalledWith(mockRole);
        });

        it('ロールが存在しない場合は自動作成する', async () => {
            const newRole = { id: 'new-role-456', name: 'valorant' };
            const member = {
                roles: {
                    cache: { has: vi.fn().mockReturnValue(false) },
                    add: vi.fn(),
                },
                user: { tag: 'TestUser#1234' },
            };
            const channel = {
                name: 'valorant',
                parent: { name: 'ゲームチャンネル' },
                guild: {
                    roles: {
                        cache: { find: vi.fn().mockReturnValue(undefined) },
                        create: vi.fn().mockResolvedValue(newRole),
                    },
                },
            };

            await RoleManager.assignRoleByChannel(member, channel);

            expect(channel.guild.roles.create).toHaveBeenCalledWith({
                name: 'valorant',
                reason: 'valorantチャンネルの自動ロール作成',
            });
            expect(member.roles.add).toHaveBeenCalledWith(newRole);
        });

        it('既にロールを持っている場合は付与しない', async () => {
            const mockRole = { id: 'role-123', name: 'apex' };
            const member = {
                roles: {
                    cache: { has: vi.fn().mockReturnValue(true) },
                    add: vi.fn(),
                },
                user: { tag: 'TestUser#1234' },
            };
            const channel = {
                name: 'apex',
                parent: { name: 'ゲームチャンネル' },
                guild: {
                    roles: {
                        cache: { find: vi.fn().mockReturnValue(mockRole) },
                    },
                },
            };

            await RoleManager.assignRoleByChannel(member, channel);

            expect(member.roles.add).not.toHaveBeenCalled();
        });

        it('エラーが発生してもクラッシュしない', async () => {
            const member = {
                roles: {
                    cache: { has: vi.fn().mockReturnValue(false) },
                    add: vi.fn().mockRejectedValue(new Error('Permission denied')),
                },
                user: { tag: 'TestUser#1234' },
            };
            const channel = {
                name: 'apex',
                parent: { name: 'ゲームチャンネル' },
                guild: {
                    roles: {
                        cache: { find: vi.fn().mockReturnValue({ id: '123', name: 'apex' }) },
                    },
                },
            };

            // エラーがthrowされないことを確認
            await expect(RoleManager.assignRoleByChannel(member, channel)).resolves.toBeUndefined();
        });
    });
});

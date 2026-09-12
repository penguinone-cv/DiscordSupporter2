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
    describe('assignRoleByChannel()', () => {
        beforeEach(() => {
            config.get.mockReturnValue(undefined);
            RoleManager.initialize();
        });

        it('非ゲームチャンネルでは何もしない', async () => {
            const member = { roles: { cache: new Map(), add: vi.fn() } };
            const channel = {
                name: 'apex',
                parent: { name: '一般カテゴリ' },
                guild: { roles: { cache: { find: vi.fn() } } },
            };

            await RoleManager.assignRoleByChannel(member, channel);

            channel.parent = null;
            await RoleManager.assignRoleByChannel(member, channel);
            expect(channel.guild.roles.cache.find).not.toHaveBeenCalled();
            expect(member.roles.add).not.toHaveBeenCalled();
        });

        it('ゲームチャンネルで既存ロールを付与する', async () => {
            const mockRole = { id: 'role-123', name: 'apex' };
            config.get.mockReturnValue('カスタムカテゴリ');
            RoleManager.initialize();
            const member = {
                roles: {
                    cache: { has: vi.fn().mockReturnValue(false) },
                    add: vi.fn(),
                },
                user: { tag: 'TestUser#1234' },
            };
            const channel = {
                name: 'apex',
                parent: { name: 'カスタムカテゴリ' },
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

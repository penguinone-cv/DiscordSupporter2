import { describe, it, expect, vi, beforeEach } from 'vitest';

// 依存モジュールをモック
vi.mock('../../src/utils/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/config/configLoader.js', () => ({
    default: { get: vi.fn() },
}));

vi.mock('../../src/services/recruitmentDetector.js', () => ({
    default: { detect: vi.fn() },
}));

vi.mock('../../src/services/roleManager.js', () => ({
    default: { assignRoleByChannel: vi.fn() },
}));

let handleMessage;
let config;
let recruitmentDetector;
let roleManager;

beforeEach(async () => {
    vi.resetModules();

    const configMod = await import('../../src/config/configLoader.js');
    config = configMod.default;

    const rdMod = await import('../../src/services/recruitmentDetector.js');
    recruitmentDetector = rdMod.default;

    const rmMod = await import('../../src/services/roleManager.js');
    roleManager = rmMod.default;

    const mod = await import('../../src/handlers/messageHandler.js');
    handleMessage = mod.default;
});

/**
 * テスト用のメッセージオブジェクトを作成するヘルパー
 */
function createMockMessage(overrides = {}) {
    return {
        id: `msg-${Math.random().toString(36).slice(2, 8)}`,
        channelId: 'channel-1',
        content: 'テストメッセージ',
        author: { bot: false, tag: 'TestUser#1234', id: 'user-1' },
        client: { user: { id: 'bot-user-id' } },
        mentions: { has: vi.fn().mockReturnValue(false) },
        channel: {
            name: 'general',
            messages: { fetch: vi.fn() },
        },
        guild: {
            id: 'guild-1',
            roles: { cache: { find: vi.fn().mockReturnValue(null) } },
        },
        member: { roles: { cache: new Map() } },
        reference: null,
        reply: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

describe('messageHandler', () => {
    describe('Bot メッセージの除外', () => {
        it('Bot のメッセージは無視する', async () => {
            const message = createMockMessage({ author: { bot: true, tag: 'Bot#0000' } });
            config.get.mockReturnValue(false);

            await handleMessage(message);

            expect(message.reply).not.toHaveBeenCalled();
        });
    });

    describe('メンション応答', () => {
        it('Bot がメンションされたら設定された応答を返す', async () => {
            const message = createMockMessage({
                mentions: { has: vi.fn().mockReturnValue(true) },
            });
            config.get.mockImplementation((key) => {
                if (key === 'features.mention.enabled') return true;
                if (key === 'features.mention.response') return 'はーい';
                if (key === 'features.recruitmentDetection.enabled') return false;
                if (key === 'features.autoRole.enabled') return false;
                return undefined;
            });

            await handleMessage(message);

            expect(message.reply).toHaveBeenCalledWith('はーい');
        });

        it('メンション機能が無効なら応答しない', async () => {
            const message = createMockMessage({
                mentions: { has: vi.fn().mockReturnValue(true) },
            });
            config.get.mockImplementation((key) => {
                if (key === 'features.mention.enabled') return false;
                if (key === 'features.recruitmentDetection.enabled') return false;
                if (key === 'features.autoRole.enabled') return false;
                return undefined;
            });

            await handleMessage(message);

            expect(message.reply).not.toHaveBeenCalled();
        });
    });

    describe('募集メッセージ検出', () => {
        it('募集メッセージ検出が有効で募集と判定されたらロールメンション付き返信する', async () => {
            const mockRole = { id: 'role-123', name: 'apex' };
            const message = createMockMessage({
                content: 'Apex一緒にやろう',
                channel: {
                    name: 'apex',
                    parent: { name: 'ゲームチャンネル' },
                    messages: { fetch: vi.fn() },
                },
                guild: {
                    id: 'guild-1',
                    roles: { cache: { find: vi.fn().mockReturnValue(mockRole) } },
                },
            });
            config.get.mockImplementation((key) => {
                if (key === 'features.mention.enabled') return false;
                if (key === 'features.recruitmentDetection.enabled') return true;
                if (key === 'features.autoRole.enabled') return false;
                return undefined;
            });
            recruitmentDetector.detect.mockResolvedValue({
                isRecruitment: true,
                reason: '募集している',
            });

            await handleMessage(message);

            expect(recruitmentDetector.detect).toHaveBeenCalledWith('Apex一緒にやろう', message.channel);
            expect(message.reply).toHaveBeenCalledWith(
                expect.objectContaining({
                    content: expect.stringContaining('<@&role-123>'),
                })
            );
        });

        it('スレッド内のメッセージは募集判定しない', async () => {
            const message = createMockMessage({
                channel: {
                    name: 'thread',
                    parent: { name: 'ゲームチャンネル' },
                    isThread: vi.fn().mockReturnValue(true),
                    messages: { fetch: vi.fn() },
                },
            });
            config.get.mockImplementation((key) => {
                if (key === 'features.mention.enabled') return false;
                if (key === 'features.recruitmentDetection.enabled') return true;
                if (key === 'features.autoRole.enabled') return false;
                return undefined;
            });

            await handleMessage(message);

            expect(recruitmentDetector.detect).not.toHaveBeenCalled();
            expect(message.reply).not.toHaveBeenCalled();
        });

        it('ゲームチャンネル以外のカテゴリーでは募集判定しない', async () => {
            const message = createMockMessage({
                channel: {
                    name: 'general',
                    parent: { name: '雑談チャンネル' },
                    messages: { fetch: vi.fn() },
                },
            });
            config.get.mockImplementation((key) => {
                if (key === 'features.mention.enabled') return false;
                if (key === 'features.recruitmentDetection.enabled') return true;
                if (key === 'features.autoRole.enabled') return false;
                return undefined;
            });

            await handleMessage(message);

            expect(recruitmentDetector.detect).not.toHaveBeenCalled();
            expect(message.reply).not.toHaveBeenCalled();
        });

        it('汎用募集チャンネルでは募集判定し、@everyone に通知する', async () => {
            const message = createMockMessage({
                content: '一緒に遊ぶ人募集',
                channel: {
                    name: '汎用募集チャンネル',
                    parent: { name: 'その他' },
                    messages: { fetch: vi.fn() },
                },
            });
            config.get.mockImplementation((key) => {
                if (key === 'features.mention.enabled') return false;
                if (key === 'features.recruitmentDetection.enabled') return true;
                if (key === 'features.autoRole.enabled') return false;
                return undefined;
            });
            recruitmentDetector.detect.mockResolvedValue({
                isRecruitment: true,
                reason: '募集している',
            });

            await handleMessage(message);

            expect(recruitmentDetector.detect).toHaveBeenCalledWith(
                '一緒に遊ぶ人募集',
                message.channel
            );
            expect(message.reply).toHaveBeenCalledWith({
                content: expect.stringContaining('@everyone'),
                allowedMentions: {
                    repliedUser: false,
                    parse: ['everyone'],
                },
            });
        });
    });

    describe('自動ロール付与', () => {
        it('autoRole が有効ならロール割り当てを呼び出す', async () => {
            const message = createMockMessage();
            config.get.mockImplementation((key) => {
                if (key === 'features.mention.enabled') return false;
                if (key === 'features.recruitmentDetection.enabled') return false;
                if (key === 'features.autoRole.enabled') return true;
                return undefined;
            });

            await handleMessage(message);

            expect(roleManager.assignRoleByChannel).toHaveBeenCalledWith(message.member, message.channel);
        });
    });
});

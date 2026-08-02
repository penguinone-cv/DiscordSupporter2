import { describe, it, expect, vi, beforeEach } from 'vitest';

// logger をモック
vi.mock('../../src/utils/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

let handleInteraction;

beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../src/handlers/interactionHandler.js');
    handleInteraction = mod.default;
});

/**
 * テスト用のインタラクションオブジェクト作成ヘルパー
 */
function createMockInteraction(overrides = {}) {
    return {
        isChatInputCommand: vi.fn().mockReturnValue(true),
        commandName: 'vote',
        replied: false,
        deferred: false,
        reply: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

describe('interactionHandler', () => {
    it('Discordのリクエスト制限では切り上げた待ち時間を表示する', async () => {
        const { interactionErrorContent } = await import('../../src/handlers/interactionHandler.js');

        expect(interactionErrorContent({
            name: 'GatewayRateLimitError',
            data: { retry_after: 4.246, opcode: 8 }
        })).toBe('現在Discordのリクエスト制限中です。5秒後にもう一度お試しください。');
    });

    it('一般ユーザー用ゲームコンポーネントを専用ハンドラーへ渡す', async () => {
        const memberHandler = vi.fn().mockResolvedValue(undefined);
        vi.doMock('../../src/interactions/gameMemberInteractionHandler.js', () => ({
            default: memberHandler,
        }));
        vi.resetModules();
        const mod = await import('../../src/handlers/interactionHandler.js');
        handleInteraction = mod.default;
        const interaction = createMockInteraction({
            isButton: vi.fn().mockReturnValue(true),
            isStringSelectMenu: vi.fn().mockReturnValue(false),
            isChatInputCommand: vi.fn().mockReturnValue(false),
            customId: 'game-user:archived:0',
        });

        await handleInteraction(interaction);

        expect(memberHandler).toHaveBeenCalledWith(interaction);
    });

    it('一般ユーザー用予定表コンポーネントを専用ハンドラーへ渡す', async () => {
        const scheduleHandler = vi.fn().mockResolvedValue(undefined);
        vi.doMock('../../src/interactions/scheduleMemberInteractionHandler.js', () => ({
            default: scheduleHandler,
        }));
        vi.resetModules();
        const mod = await import('../../src/handlers/interactionHandler.js');
        handleInteraction = mod.default;
        const interaction = createMockInteraction({
            isButton: vi.fn().mockReturnValue(true),
            isStringSelectMenu: vi.fn().mockReturnValue(false),
            isChatInputCommand: vi.fn().mockReturnValue(false),
            customId: 'schedule-user:basic:0',
        });

        await handleInteraction(interaction);

        expect(scheduleHandler).toHaveBeenCalledWith(interaction);
    });

    it('スラッシュコマンド以外は無視する', async () => {
        const interaction = createMockInteraction({
            isChatInputCommand: vi.fn().mockReturnValue(false),
        });

        await handleInteraction(interaction);

        expect(interaction.reply).not.toHaveBeenCalled();
    });

    it('不明なコマンドにはエラーメッセージで応答する', async () => {
        const interaction = createMockInteraction({ commandName: 'unknown' });

        await handleInteraction(interaction);

        expect(interaction.reply).toHaveBeenCalledWith(
            expect.objectContaining({
                content: '不明なコマンドです。',
                ephemeral: true,
            })
        );
    });

    it('コマンド実行中のエラーで interaction.reply が未済の場合 reply で応答する', async () => {
        // vote コマンドをモックしてエラーを発生させる
        vi.doMock('../../src/commands/vote.js', () => ({
            default: {
                execute: vi.fn().mockRejectedValue(new Error('テストエラー')),
            },
        }));

        // interactionHandlerを再読み込み
        vi.resetModules();
        const mod = await import('../../src/handlers/interactionHandler.js');
        handleInteraction = mod.default;

        const interaction = createMockInteraction({
            commandName: 'vote',
            replied: false,
            deferred: false,
        });

        await handleInteraction(interaction);

        expect(interaction.reply).toHaveBeenCalledWith(
            expect.objectContaining({
                content: 'コマンドの実行中にエラーが発生しました。',
                ephemeral: true,
            })
        );
    });

    it('コマンド実行中のエラーで interaction.replied が true の場合 followUp で応答する', async () => {
        vi.doMock('../../src/commands/vote.js', () => ({
            default: {
                execute: vi.fn().mockRejectedValue(new Error('テストエラー')),
            },
        }));

        vi.resetModules();
        const mod = await import('../../src/handlers/interactionHandler.js');
        handleInteraction = mod.default;

        const interaction = createMockInteraction({
            commandName: 'vote',
            replied: true,
            deferred: false,
        });

        await handleInteraction(interaction);

        expect(interaction.followUp).toHaveBeenCalledWith(
            expect.objectContaining({
                content: 'コマンドの実行中にエラーが発生しました。',
                ephemeral: true,
            })
        );
    });
});

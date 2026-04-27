import { describe, it, expect, vi, beforeEach } from 'vitest';

// logger をモック
vi.mock('../../src/utils/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

let handleChannelCreate;

beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../src/handlers/channelCreateHandler.js');
    handleChannelCreate = mod.default;
});

describe('channelCreateHandler', () => {
    it('テキストチャンネルに初期メッセージを投稿する', async () => {
        const channel = {
            isTextBased: vi.fn().mockReturnValue(true),
            guild: { id: 'guild-1' },
            name: 'apex',
            send: vi.fn().mockResolvedValue(undefined),
        };

        await handleChannelCreate(channel);

        expect(channel.send).toHaveBeenCalledWith('ここはapexの遊び場');
    });

    it('非テキストチャンネルでは何もしない', async () => {
        const channel = {
            isTextBased: vi.fn().mockReturnValue(false),
            guild: { id: 'guild-1' },
            name: 'voice-channel',
            send: vi.fn(),
        };

        await handleChannelCreate(channel);

        expect(channel.send).not.toHaveBeenCalled();
    });

    it('DMチャンネル（guild無し）では何もしない', async () => {
        const channel = {
            isTextBased: vi.fn().mockReturnValue(true),
            guild: null,
            name: 'dm-channel',
            send: vi.fn(),
        };

        await handleChannelCreate(channel);

        expect(channel.send).not.toHaveBeenCalled();
    });

    it('エラーが発生してもクラッシュしない', async () => {
        const channel = {
            isTextBased: vi.fn().mockReturnValue(true),
            guild: { id: 'guild-1' },
            name: 'error-channel',
            send: vi.fn().mockRejectedValue(new Error('Permission denied')),
        };

        await expect(handleChannelCreate(channel)).resolves.toBeUndefined();
    });
});

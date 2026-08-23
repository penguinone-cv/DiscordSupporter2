import { describe, it, expect, vi, beforeEach } from 'vitest';

// 依存モジュールをモック
vi.mock('../../src/utils/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/config/configLoader.js', () => ({
    default: { get: vi.fn() },
}));

vi.mock('../../src/services/roleManager.js', () => ({
    default: { assignRoleByChannel: vi.fn() },
}));

vi.mock('../../src/services/gameRecruitmentService.js', () => ({
    default: { handleReactionChange: vi.fn() },
}));

import handleReactionAdd, { handleReactionRemove } from '../../src/handlers/reactionHandler.js';
import config from '../../src/config/configLoader.js';
import roleManager from '../../src/services/roleManager.js';
import gameRecruitmentService from '../../src/services/gameRecruitmentService.js';

describe('reactionHandler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('Bot のリアクションは無視する', async () => {
        const reaction = { partial: false, message: {} };
        const user = { bot: true, id: 'bot-id' };

        await handleReactionAdd(reaction, user);

        expect(roleManager.assignRoleByChannel).not.toHaveBeenCalled();
        expect(gameRecruitmentService.handleReactionChange).not.toHaveBeenCalled();
    });

    it('autoRole 機能が無効でも募集リアクションは処理する', async () => {
        const reaction = { partial: false, message: {} };
        const user = { bot: false, id: 'user-1' };
        config.get.mockReturnValue(false);

        await handleReactionAdd(reaction, user);

        expect(roleManager.assignRoleByChannel).not.toHaveBeenCalled();
        expect(gameRecruitmentService.handleReactionChange)
            .toHaveBeenCalledWith(reaction, user, { removed: false });
    });

    it('パーシャルの場合はフェッチしてからロール付与する', async () => {
        const mockMember = { id: 'member-1' };
        const reaction = {
            partial: true,
            fetch: vi.fn().mockResolvedValue(undefined),
            message: {
                channel: { name: 'apex' },
                guild: {
                    id: 'guild-1',
                    members: { fetch: vi.fn().mockResolvedValue(mockMember) },
                },
            },
        };
        const user = { bot: false, id: 'user-1' };
        config.get.mockReturnValue(true);

        await handleReactionAdd(reaction, user);

        expect(reaction.fetch).toHaveBeenCalled();
        expect(roleManager.assignRoleByChannel).toHaveBeenCalledWith(mockMember, reaction.message.channel);
    });

    it('guild が存在しない場合は処理をスキップする', async () => {
        const reaction = {
            partial: false,
            message: {
                channel: { name: 'dm' },
                guild: null,
            },
        };
        const user = { bot: false, id: 'user-1' };
        config.get.mockReturnValue(true);

        await handleReactionAdd(reaction, user);

        expect(roleManager.assignRoleByChannel).not.toHaveBeenCalled();
    });

    it('正常フローでロール付与を呼び出す', async () => {
        const mockMember = { id: 'member-1' };
        const reaction = {
            partial: false,
            message: {
                channel: { name: 'apex' },
                guild: {
                    id: 'guild-1',
                    members: { fetch: vi.fn().mockResolvedValue(mockMember) },
                },
            },
        };
        const user = { bot: false, id: 'user-1' };
        config.get.mockReturnValue(true);

        await handleReactionAdd(reaction, user);

        expect(roleManager.assignRoleByChannel).toHaveBeenCalledWith(mockMember, reaction.message.channel);
    });

    it('リアクション削除を募集の参加者更新へ渡す', async () => {
        const reaction = { partial: false, message: { id: 'message-1' } };
        const user = { bot: false, id: 'user-1' };

        await handleReactionRemove(reaction, user);

        expect(gameRecruitmentService.handleReactionChange)
            .toHaveBeenCalledWith(reaction, user, { removed: true });
        expect(roleManager.assignRoleByChannel).not.toHaveBeenCalled();
    });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    buildMainPanel,
    buildPreferenceEditor,
    updatePreferencePage,
    buildArchivedList,
    buildGameDetail,
    toggle,
    refreshPanel
} = vi.hoisted(() => ({
    buildMainPanel: vi.fn(),
    buildPreferenceEditor: vi.fn(),
    updatePreferencePage: vi.fn(),
    buildArchivedList: vi.fn(),
    buildGameDetail: vi.fn(),
    toggle: vi.fn(),
    refreshPanel: vi.fn()
}));

vi.mock('../../src/services/gameMemberPanelService.js', () => ({
    default: {
        buildMainPanel,
        buildPreferenceEditor,
        updatePreferencePage,
        buildArchivedList,
        buildGameDetail
    }
}));
vi.mock('../../src/services/gameReturnRequestService.js', () => ({
    default: { toggle }
}));
vi.mock('../../src/services/gameAdminPanelService.js', () => ({
    default: { refreshPanel }
}));

import handleGameMemberInteraction from '../../src/interactions/gameMemberInteractionHandler.js';

describe('gameMemberInteractionHandler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        buildMainPanel.mockReturnValue({ content: 'main-panel' });
        buildPreferenceEditor.mockReturnValue({ content: 'preference-editor' });
        updatePreferencePage.mockReturnValue({ content: 'preference-saved' });
        buildArchivedList.mockReturnValue({ content: 'archived-list' });
        buildGameDetail.mockReturnValue({ content: 'game-detail' });
        toggle.mockResolvedValue({ requested: true, count: 1 });
        refreshPanel.mockResolvedValue(undefined);
    });

    function interaction(overrides = {}) {
        return {
            customId: 'game-user:archived:0',
            inGuild: () => true,
            guild: { id: 'guild-1' },
            guildId: 'guild-1',
            user: { id: 'user-1', bot: false },
            values: [],
            message: { flags: { has: () => false } },
            reply: vi.fn().mockResolvedValue(undefined),
            update: vi.fn().mockResolvedValue(undefined),
            deferUpdate: vi.fn().mockResolvedValue(undefined),
            editReply: vi.fn().mockResolvedValue(undefined),
            ...overrides
        };
    }

    it('公開パネルからゲーム希望編集を本人だけに表示する', async () => {
        const target = interaction({ customId: 'game-user:preferences:2' });

        await handleGameMemberInteraction(target);

        expect(buildPreferenceEditor).toHaveBeenCalledWith(
            target.guild,
            'user-1',
            2
        );
        expect(target.reply).toHaveBeenCalledWith(expect.objectContaining({
            content: 'preference-editor'
        }));
        expect(target.reply.mock.calls[0][0].flags).toBeTruthy();
    });

    it('選択したゲーム希望を保存して編集画面を更新する', async () => {
        const target = interaction({
            customId: 'game-user:preferences-save:1',
            values: ['12', '13']
        });

        await handleGameMemberInteraction(target);

        expect(updatePreferencePage).toHaveBeenCalledWith(
            target.guild,
            'user-1',
            1,
            ['12', '13']
        );
        expect(target.update).toHaveBeenCalledWith({ content: 'preference-saved' });
    });

    it('公開パネルから休止中一覧を本人だけに表示する', async () => {
        const target = interaction();

        await handleGameMemberInteraction(target);

        expect(buildArchivedList).toHaveBeenCalledWith(target.guild, 0);
        expect(target.reply).toHaveBeenCalledWith(expect.objectContaining({
            content: 'archived-list'
        }));
        expect(target.reply.mock.calls[0][0].flags).toBeTruthy();
    });

    it('復帰希望を切り替えて管理パネルと本人の詳細を更新する', async () => {
        const target = interaction({ customId: 'game-user:restore-toggle:12:2' });

        await handleGameMemberInteraction(target);

        expect(target.deferUpdate).toHaveBeenCalledOnce();
        expect(toggle).toHaveBeenCalledWith({
            guild: target.guild,
            gameId: 12,
            userId: 'user-1'
        });
        expect(refreshPanel).toHaveBeenCalledWith(target.guild);
        expect(buildGameDetail).toHaveBeenCalledWith(target.guild, 'user-1', 12, 2);
        expect(target.editReply).toHaveBeenCalledWith({ content: 'game-detail' });
    });
});

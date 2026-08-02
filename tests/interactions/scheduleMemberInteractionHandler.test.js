import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    buildMainPanel,
    buildBasicEditor,
    buildCandidateResults,
    cycleBasicStatus
} = vi.hoisted(() => ({
    buildMainPanel: vi.fn(),
    buildBasicEditor: vi.fn(),
    buildCandidateResults: vi.fn(),
    cycleBasicStatus: vi.fn()
}));

vi.mock('../../src/services/gameMemberPanelService.js', () => ({
    default: { buildMainPanel }
}));
vi.mock('../../src/services/scheduleService.js', () => ({
    default: { cycleBasicStatus }
}));
vi.mock('../../src/services/schedulePanelService.js', () => ({
    default: { buildBasicEditor, buildCandidateResults }
}));

import handleScheduleMemberInteraction from '../../src/interactions/scheduleMemberInteractionHandler.js';

describe('scheduleMemberInteractionHandler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        buildMainPanel.mockReturnValue({ content: 'home' });
        buildBasicEditor.mockReturnValue({ content: 'basic' });
        buildCandidateResults.mockResolvedValue({ content: 'candidates' });
    });

    function interaction(overrides = {}) {
        return {
            customId: 'schedule-user:basic:0',
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

    it('公開パネルから基本予定を本人だけに表示する', async () => {
        const target = interaction();

        await handleScheduleMemberInteraction(target);

        expect(buildBasicEditor).toHaveBeenCalledWith(target.guild, 'user-1', 0);
        expect(target.reply).toHaveBeenCalledWith(expect.objectContaining({
            content: 'basic'
        }));
        expect(target.reply.mock.calls[0][0].flags).toBeTruthy();
    });

    it('基本予定を切り替えて同じ画面を更新する', async () => {
        const target = interaction({ customId: 'schedule-user:basic-cycle:2:12' });

        await handleScheduleMemberInteraction(target);

        expect(cycleBasicStatus).toHaveBeenCalledWith({
            guildId: 'guild-1',
            userId: 'user-1',
            requestedPage: 2,
            templateId: 12
        });
        expect(target.update).toHaveBeenCalledWith({ content: 'basic' });
    });

    it('候補日時集計中は先に応答を保留してから結果を表示する', async () => {
        const target = interaction({
            customId: 'schedule-user:candidate-select:3:1',
            values: ['42']
        });

        await handleScheduleMemberInteraction(target);

        expect(target.deferUpdate).toHaveBeenCalledOnce();
        expect(buildCandidateResults).toHaveBeenCalledWith(target.guild, 3, 42, 1);
        expect(target.editReply).toHaveBeenCalledWith({ content: 'candidates' });
    });
});

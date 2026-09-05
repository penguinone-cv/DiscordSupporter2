import { MessageFlags } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    buildMainPanel,
    buildBasicEditor,
    buildCandidateResults,
    cycleBasicStatus,
    createRecruitment,
    getConfig
} = vi.hoisted(() => ({
    buildMainPanel: vi.fn(),
    buildBasicEditor: vi.fn(),
    buildCandidateResults: vi.fn(),
    cycleBasicStatus: vi.fn(),
    createRecruitment: vi.fn(),
    getConfig: vi.fn()
}));

vi.mock('../../src/config/configLoader.js', () => ({
    default: { get: getConfig }
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
vi.mock('../../src/services/gameRecruitmentService.js', () => ({
    default: { createRecruitment }
}));

import handleScheduleMemberInteraction from '../../src/interactions/scheduleMemberInteractionHandler.js';

describe('scheduleMemberInteractionHandler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getConfig.mockReturnValue(false);
        buildMainPanel.mockReturnValue({ content: 'home' });
        buildBasicEditor.mockReturnValue({ content: 'basic' });
        buildCandidateResults.mockResolvedValue({ content: 'candidates' });
        createRecruitment.mockResolvedValue({});
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
            deferReply: vi.fn().mockResolvedValue(undefined),
            launchActivity: vi.fn().mockResolvedValue(undefined),
            ...overrides
        };
    }

    it('有効なActivityを保留や通常応答せず直接起動する', async () => {
        getConfig.mockReturnValue(true);
        const target = interaction({ customId: 'schedule-user:activity-open' });

        await handleScheduleMemberInteraction(target);

        expect(getConfig).toHaveBeenCalledWith('activity.enabled');
        expect(target.launchActivity).toHaveBeenCalledOnce();
        expect(target.deferUpdate).not.toHaveBeenCalled();
        expect(target.deferReply).not.toHaveBeenCalled();
        expect(target.reply).not.toHaveBeenCalled();
        expect(target.update).not.toHaveBeenCalled();
    });

    it('Activity無効時には本人だけに週表示の利用を案内する', async () => {
        const target = interaction({ customId: 'schedule-user:activity-open' });

        await handleScheduleMemberInteraction(target);

        expect(target.launchActivity).not.toHaveBeenCalled();
        expect(target.reply).toHaveBeenCalledWith({
            content: 'カレンダーは現在利用できません。「月間予定（週表示）」から予定を編集してください。',
            flags: MessageFlags.Ephemeral
        });
    });
    it('Activity起動失敗時にも週表示を案内する', async () => {
        getConfig.mockReturnValue(true);
        const target = interaction({ customId: 'schedule-user:activity-open', launchActivity: vi.fn().mockRejectedValue(new Error('unavailable')) });
        await handleScheduleMemberInteraction(target);
        expect(target.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('月間予定（週表示）'), flags: MessageFlags.Ephemeral }));
    });

    it.each([
        ['サーバー外', { inGuild: () => false }, 'サーバー内でのみ操作できます'],
        ['Bot', { user: { id: 'bot-1', bot: true } }, '一般メンバーのみ操作できます'],
        ['ユーザー不明', { user: null }, '一般メンバーのみ操作できます']
    ])('%sからActivityを起動させない', async (_label, overrides, error) => {
        getConfig.mockReturnValue(true);
        const target = interaction({ customId: 'schedule-user:activity-open', ...overrides });

        await expect(handleScheduleMemberInteraction(target)).rejects.toThrow(error);

        expect(target.launchActivity).not.toHaveBeenCalled();
        expect(getConfig).not.toHaveBeenCalled();
    });

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

    it('候補日程集計中は先に応答を保留してから結果を表示する', async () => {
        const target = interaction({
            customId: 'schedule-user:candidate-select:3:1',
            values: ['42']
        });

        await handleScheduleMemberInteraction(target);

        expect(target.deferUpdate).toHaveBeenCalledOnce();
        expect(buildCandidateResults).toHaveBeenCalledWith(target.guild, 3, 42, 1);
        expect(target.editReply).toHaveBeenCalledWith({ content: null });
    });

    it('候補日程を選ぶと同じ画面を選択済み状態へ更新する', async () => {
        const target = interaction({
            customId: 'schedule-user:candidate-slot-select:3:42:1',
            values: ['99']
        });

        await handleScheduleMemberInteraction(target);

        expect(target.deferUpdate).toHaveBeenCalledOnce();
        expect(buildCandidateResults).toHaveBeenCalledWith(target.guild, 3, 42, 1, 99);
        expect(target.editReply).toHaveBeenCalledWith({ content: null });
    });

    it('選択済み候補から募集を作成し完了表示へ更新する', async () => {
        const target = interaction({
            customId: 'schedule-user:candidate-recruit:3:42:1:99'
        });

        await handleScheduleMemberInteraction(target);

        expect(target.deferUpdate).toHaveBeenCalledOnce();
        expect(createRecruitment).toHaveBeenCalledWith({
            guild: target.guild,
            monthId: 3,
            gameId: 42,
            slotId: 99,
            userId: 'user-1'
        });
        expect(buildCandidateResults).toHaveBeenCalledWith(target.guild, 3, 42, 1, 99);
        expect(target.editReply).toHaveBeenCalledWith({
            content: expect.stringContaining('募集メッセージを送信しました')
        });
    });

    it('候補日程が未選択なら募集を作成しない', async () => {
        const target = interaction({
            customId: 'schedule-user:candidate-recruit:3:42:1:none'
        });

        await expect(handleScheduleMemberInteraction(target))
            .rejects.toThrow('募集する候補日程を選択してください');

        expect(createRecruitment).not.toHaveBeenCalled();
    });

    it('重複など利用者が修正できる募集エラーを本人へ表示する', async () => {
        const target = interaction({
            customId: 'schedule-user:candidate-recruit:3:42:1:99'
        });
        const error = new Error('このゲームと候補日程の募集はすでに作成されています');
        error.name = 'GameRecruitmentError';
        createRecruitment.mockRejectedValueOnce(error);

        await handleScheduleMemberInteraction(target);

        expect(target.editReply).toHaveBeenCalledWith({
            content: `❌ ${error.message}`
        });
        expect(buildCandidateResults).not.toHaveBeenCalled();
    });
});

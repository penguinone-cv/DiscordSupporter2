import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import database from '../../src/repositories/database.js';
import availabilityRepository from '../../src/repositories/availabilityRepository.js';
import gameRepository from '../../src/repositories/gameRepository.js';
import gameRecruitmentRepository, {
    RecruitmentConflictCode,
    RecruitmentConflictError
} from '../../src/repositories/gameRecruitmentRepository.js';

describe('gameRecruitmentRepository', () => {
    beforeEach(() => {
        database.close();
        database.initialize(':memory:');
    });

    afterEach(() => {
        database.close();
    });

    function createGame(channelId = 'channel-1') {
        return gameRepository.registerChannel({
            guildId: 'guild-1',
            channelId,
            channelName: `game-${channelId}`,
            parentCategoryId: 'category-1',
            roleId: `role-${channelId}`
        });
    }

    function createSlot(localDate = '2026-09-01') {
        const [template] = availabilityRepository.ensureDefaultTemplates('guild-1');
        const month = availabilityRepository.ensureMonth('guild-1', 2026, 9);
        availabilityRepository.insertSlots(month.id, [{
            templateId: template.id,
            localDate,
            dayRule: '1',
            label: template.label,
            startMinutes: template.start_minutes,
            endMinutes: template.end_minutes,
            sortOrder: template.sort_order
        }]);
        return availabilityRepository.listMonthSlots('guild-1', month.id)
            .find(slot => slot.local_date === localDate);
    }

    function reserve(game, slot) {
        return gameRecruitmentRepository.reserve({
            guildId: 'guild-1',
            gameId: game.id,
            slotId: slot.id,
            channelId: game.current_channel_id,
            roleId: game.current_role_id,
            creatorUserId: 'user-1'
        });
    }

    it('確保から有効化、開催確定、リマインド登録まで状態を永続化する', () => {
        const game = createGame();
        const slot = createSlot();
        const pending = reserve(game, slot);

        expect(pending).toEqual(expect.objectContaining({
            guild_id: 'guild-1',
            game_id: game.id,
            slot_id: slot.id,
            channel_id: 'channel-1',
            role_id: 'role-channel-1',
            creator_user_id: 'user-1',
            message_id: null,
            confirmation_emoji_id: null,
            status: 'pending',
            confirmed_by_user_id: null,
            confirmed_at: null,
            reminder_id: null
        }));
        expect(gameRecruitmentRepository.findByGameSlot(game.id, slot.id)?.id)
            .toBe(pending.id);

        const open = gameRecruitmentRepository.activate(pending.id, {
            messageId: 'message-1',
            confirmationEmojiId: 'emoji-1'
        });
        expect(open).toEqual(expect.objectContaining({
            message_id: 'message-1',
            confirmation_emoji_id: 'emoji-1',
            status: 'open'
        }));
        expect(gameRecruitmentRepository.findByMessageId('message-1')?.id)
            .toBe(pending.id);

        const confirmed = gameRecruitmentRepository.markConfirmed(pending.id, 'user-2');
        expect(confirmed).toEqual(expect.objectContaining({
            status: 'confirmed',
            confirmed_by_user_id: 'user-2'
        }));
        expect(confirmed.confirmed_at).toEqual(expect.any(String));
        expect(gameRecruitmentRepository.markConfirmed(pending.id, 'user-3')).toBeNull();

        const reminded = gameRecruitmentRepository.setReminderId(pending.id, 'reminder-1');
        expect(reminded.reminder_id).toBe('reminder-1');
        expect(gameRecruitmentRepository.setReminderId(pending.id, 'reminder-2')).toBeNull();
        expect(gameRecruitmentRepository.findById(pending.id)?.reminder_id)
            .toBe('reminder-1');
        expect(gameRecruitmentRepository.remove(pending.id)).toBe(false);
    });

    it('送信前のpending確保を削除できる', () => {
        const pending = reserve(createGame(), createSlot());

        expect(gameRecruitmentRepository.remove(pending.id)).toBe(true);
        expect(gameRecruitmentRepository.findById(pending.id)).toBeNull();
        expect(gameRecruitmentRepository.remove(pending.id)).toBe(false);
    });

    it('メッセージ送信失敗時はpending確保を解放できる', () => {
        const pending = reserve(createGame(), createSlot());

        expect(gameRecruitmentRepository.release(pending.id)).toBe(true);
        expect(gameRecruitmentRepository.findById(pending.id)).toBeNull();
    });

    it('リアクション初期化失敗時はopenの確保も解放できる', () => {
        const pending = reserve(createGame(), createSlot());
        gameRecruitmentRepository.activate(pending.id, {
            messageId: 'message-1',
            confirmationEmojiId: 'emoji-1'
        });

        expect(gameRecruitmentRepository.remove(pending.id)).toBe(false);
        expect(gameRecruitmentRepository.release(pending.id)).toBe(true);
        expect(gameRecruitmentRepository.findById(pending.id)).toBeNull();
    });

    it('同じゲームと候補日時の重複を専用エラーで通知する', () => {
        const game = createGame();
        const slot = createSlot();
        reserve(game, slot);

        let conflict;
        try {
            reserve(game, slot);
        } catch (error) {
            conflict = error;
        }

        expect(conflict).toBeInstanceOf(RecruitmentConflictError);
        expect(conflict.code).toBe(RecruitmentConflictCode.GAME_SLOT_ALREADY_RESERVED);
    });

    it('同じDiscordメッセージの紐付けを専用エラーで通知する', () => {
        const first = reserve(createGame('channel-1'), createSlot('2026-09-01'));
        const second = reserve(createGame('channel-2'), createSlot('2026-09-02'));
        gameRecruitmentRepository.activate(first.id, {
            messageId: 'message-1',
            confirmationEmojiId: 'emoji-1'
        });

        let conflict;
        try {
            gameRecruitmentRepository.activate(second.id, {
                messageId: 'message-1',
                confirmationEmojiId: 'emoji-1'
            });
        } catch (error) {
            conflict = error;
        }

        expect(conflict).toBeInstanceOf(RecruitmentConflictError);
        expect(conflict.code).toBe(RecruitmentConflictCode.MESSAGE_ALREADY_LINKED);
        expect(gameRecruitmentRepository.findById(second.id)?.status).toBe('pending');
    });

    it('開催確定前はリマインドIDを保存しない', () => {
        const pending = reserve(createGame(), createSlot());
        expect(gameRecruitmentRepository.setReminderId(pending.id, 'reminder-1')).toBeNull();

        gameRecruitmentRepository.activate(pending.id, {
            messageId: 'message-1',
            confirmationEmojiId: 'emoji-1'
        });
        expect(gameRecruitmentRepository.setReminderId(pending.id, 'reminder-1')).toBeNull();
        expect(gameRecruitmentRepository.findById(pending.id)?.reminder_id).toBeNull();
    });
});

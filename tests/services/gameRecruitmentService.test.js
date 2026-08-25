import { Collection, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/repositories/availabilityRepository.js', () => ({
    default: {
        findUserSlot: vi.fn(),
        findMonthById: vi.fn()
    }
}));

vi.mock('../../src/repositories/gameRecruitmentRepository.js', () => ({
    default: {
        reserve: vi.fn(),
        activate: vi.fn(),
        release: vi.fn(),
        findById: vi.fn(),
        findByMessageId: vi.fn(),
        markConfirmed: vi.fn(),
        setReminderId: vi.fn()
    }
}));

vi.mock('../../src/repositories/gameRepository.js', () => ({
    default: { findById: vi.fn() }
}));

vi.mock('../../src/services/gameCandidateService.js', () => ({
    default: { aggregate: vi.fn() }
}));

vi.mock('../../src/services/reminderService.js', () => ({
    default: {
        createReminder: vi.fn(),
        extractDate: vi.fn()
    }
}));

vi.mock('../../src/utils/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

const availabilityRepository = (await import(
    '../../src/repositories/availabilityRepository.js'
)).default;
const gameRecruitmentRepository = (await import(
    '../../src/repositories/gameRecruitmentRepository.js'
)).default;
const gameRepository = (await import('../../src/repositories/gameRepository.js')).default;
const gameCandidateService = (await import('../../src/services/gameCandidateService.js')).default;
const reminderService = (await import('../../src/services/reminderService.js')).default;
const {
    ATTENDING_EMOJI,
    CONFIRMATION_EMOJI_NAME,
    DECLINING_EMOJI,
    default: gameRecruitmentService
} = await import('../../src/services/gameRecruitmentService.js');

const GUILD_ID = 'guild-1';
const CHANNEL_ID = 'channel-1';
const ROLE_ID = 'role-1';
const MESSAGE_ID = 'message-1';
const EMOJI_ID = 'partyparrot-1';

function user(id, bot = false) {
    return { id, bot };
}

function userCollection(...users) {
    return new Collection(users.map(item => [item.id, item]));
}

function reactionFor(message, emoji, users = []) {
    const currentUsers = userCollection(...users);
    return {
        emoji,
        message,
        partial: false,
        users: {
            fetch: vi.fn().mockImplementation(async () => currentUsers),
            remove: vi.fn().mockImplementation(async userId => currentUsers.delete(userId))
        }
    };
}

function embedJson(payload) {
    return payload.embeds[0].toJSON();
}

function expectDateOnlySchedule(embed, dateLabel, slotLabel) {
    expect(embed.description).toContain(`**開催日:** ${dateLabel}`);
    expect(embed.description).toContain(`**時間枠:** ${slotLabel}`);
    expect(embed.description).not.toMatch(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/);
    expect(embed.description).not.toContain('<t:');
}

describe('gameRecruitmentService', () => {
    let game;
    let month;
    let candidate;
    let slot;
    let role;
    let confirmationEmoji;
    let channel;
    let message;
    let guild;
    let pendingRecruitment;
    let openRecruitment;
    let confirmedRecruitment;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-23T00:00:00.000Z'));
        gameRecruitmentService.messageQueues.clear();
        gameRecruitmentService.latestAttendanceAdds.clear();
        gameRecruitmentService.attendanceSequence = 0;

        game = {
            id: 11,
            guild_id: GUILD_ID,
            display_name: 'Apex Legends',
            lifecycle_status: 'active',
            current_channel_id: CHANNEL_ID,
            current_role_id: ROLE_ID
        };
        month = { id: 21, guild_id: GUILD_ID, timezone: 'Asia/Tokyo' };
        candidate = {
            slotId: 31,
            localDate: '2026-08-24',
            label: '夜',
            startMinutes: 21 * 60,
            endMinutes: null
        };
        slot = {
            id: candidate.slotId,
            month_id: month.id,
            local_date: candidate.localDate,
            label: candidate.label,
            start_minutes: candidate.startMinutes,
            end_minutes: candidate.endMinutes
        };
        role = { id: ROLE_ID, guild: { id: GUILD_ID } };
        confirmationEmoji = {
            id: EMOJI_ID,
            name: CONFIRMATION_EMOJI_NAME,
            guild: { id: GUILD_ID }
        };
        message = {
            id: MESSAGE_ID,
            channelId: CHANNEL_ID,
            guild: null,
            react: vi.fn().mockResolvedValue(undefined),
            edit: vi.fn().mockResolvedValue(undefined),
            reply: vi.fn().mockResolvedValue(undefined),
            delete: vi.fn().mockResolvedValue(undefined),
            reactions: { cache: new Collection() }
        };
        channel = {
            id: CHANNEL_ID,
            guild: { id: GUILD_ID },
            isSendable: () => true,
            send: vi.fn().mockResolvedValue(message)
        };
        guild = {
            id: GUILD_ID,
            channels: {
                cache: new Collection([[CHANNEL_ID, channel]]),
                fetch: vi.fn()
            },
            roles: {
                cache: new Collection([[ROLE_ID, role]]),
                fetch: vi.fn()
            },
            emojis: {
                cache: new Collection([[EMOJI_ID, confirmationEmoji]]),
                fetch: vi.fn().mockResolvedValue(
                    new Collection([[EMOJI_ID, confirmationEmoji]])
                )
            },
            members: {
                cache: new Collection(),
                fetch: vi.fn()
            }
        };
        message.guild = guild;
        message.channel = channel;

        pendingRecruitment = {
            id: 41,
            guild_id: GUILD_ID,
            game_id: game.id,
            slot_id: slot.id,
            channel_id: CHANNEL_ID,
            role_id: ROLE_ID,
            creator_user_id: 'creator-1',
            message_id: null,
            confirmation_emoji_id: null,
            status: 'pending'
        };
        openRecruitment = {
            ...pendingRecruitment,
            message_id: MESSAGE_ID,
            confirmation_emoji_id: EMOJI_ID,
            status: 'open'
        };
        confirmedRecruitment = {
            ...openRecruitment,
            status: 'confirmed',
            confirmed_by_user_id: 'participant-1'
        };

        gameCandidateService.aggregate.mockResolvedValue({
            game,
            month,
            candidates: [candidate]
        });
        gameRecruitmentRepository.reserve.mockReturnValue(pendingRecruitment);
        gameRecruitmentRepository.activate.mockReturnValue(openRecruitment);
        gameRecruitmentRepository.release.mockReturnValue(true);
        gameRecruitmentRepository.findByMessageId.mockReturnValue(openRecruitment);
        gameRecruitmentRepository.findById.mockReturnValue(openRecruitment);
        gameRecruitmentRepository.markConfirmed.mockReturnValue(confirmedRecruitment);
        gameRecruitmentRepository.setReminderId.mockReturnValue({
            ...confirmedRecruitment,
            reminder_id: 'reminder-1'
        });
        gameRepository.findById.mockReturnValue(game);
        availabilityRepository.findUserSlot.mockReturnValue(slot);
        availabilityRepository.findMonthById.mockReturnValue(month);
        reminderService.createReminder.mockResolvedValue({ id: 'reminder-1' });
    });

    it('候補日程を予約し、ロールメンション付き募集と3種類の初期リアクションを作成する', async () => {
        const result = await gameRecruitmentService.createRecruitment({
            guild,
            monthId: month.id,
            gameId: game.id,
            slotId: slot.id,
            userId: 'creator-1'
        });

        expect(result).toEqual({ recruitment: openRecruitment, message });
        expect(gameRecruitmentRepository.reserve).toHaveBeenCalledWith({
            guildId: GUILD_ID,
            gameId: game.id,
            slotId: slot.id,
            channelId: CHANNEL_ID,
            roleId: ROLE_ID,
            creatorUserId: 'creator-1'
        });
        expect(channel.send).toHaveBeenCalledWith(expect.objectContaining({
            content: `<@&${ROLE_ID}>`,
            allowedMentions: { parse: [], roles: [ROLE_ID], users: [] }
        }));
        const initialEmbed = embedJson(channel.send.mock.calls[0][0]);
        expectDateOnlySchedule(initialEmbed, '2026年8月24日（月）', '夜');
        expect(initialEmbed.fields).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: '状態', value: '🟢 募集中' }),
            expect.objectContaining({ name: `${ATTENDING_EMOJI} 参加者 (0人)`, value: 'なし' }),
            expect.objectContaining({ name: `${DECLINING_EMOJI} 参加不可 (0人)`, value: 'なし' })
        ]));
        expect(gameRecruitmentRepository.activate).toHaveBeenCalledWith(pendingRecruitment.id, {
            messageId: MESSAGE_ID,
            confirmationEmojiId: EMOJI_ID
        });
        expect(message.react.mock.calls.map(call => call[0])).toEqual([
            ATTENDING_EMOJI,
            DECLINING_EMOJI,
            confirmationEmoji
        ]);
        expect(gameRecruitmentRepository.reserve.mock.invocationCallOrder[0])
            .toBeLessThan(channel.send.mock.invocationCallOrder[0]);
        expect(channel.send.mock.invocationCallOrder[0])
            .toBeLessThan(gameRecruitmentRepository.activate.mock.invocationCallOrder[0]);
        expect(gameRecruitmentRepository.activate.mock.invocationCallOrder[0])
            .toBeLessThan(message.react.mock.invocationCallOrder[0]);
    });

    it('参加者が多い場合もDiscordのembed field上限内で人数を表示する', () => {
        const ids = Array.from(
            { length: 100 },
            (_value, index) => String(100000000000000000n + BigInt(index))
        );
        const embed = gameRecruitmentService.buildEmbed({
            game,
            month,
            slot,
            attendingIds: ids,
            decliningIds: ids
        }).toJSON();
        const responseFields = embed.fields.filter(field => (
            field.name.startsWith(ATTENDING_EMOJI)
            || field.name.startsWith(DECLINING_EMOJI)
        ));

        expect(responseFields).toHaveLength(2);
        expect(responseFields.every(field => field.value.length <= 1024)).toBe(true);
        expect(responseFields.every(field => field.value.includes('ほか'))).toBe(true);
        expect(responseFields.map(field => field.name)).toEqual([
            `${ATTENDING_EMOJI} 参加者 (100人)`,
            `${DECLINING_EMOJI} 参加不可 (100人)`
        ]);
    });

    it('固定開始時刻を過ぎても月間予定タイムゾーンの当日候補を募集できる', async () => {
        vi.setSystemTime(new Date('2026-08-24T13:30:00.000Z'));

        await expect(gameRecruitmentService.createRecruitment({
            guild,
            monthId: month.id,
            gameId: game.id,
            slotId: slot.id,
            userId: 'creator-1'
        })).resolves.toEqual({ recruitment: openRecruitment, message });

        expect(channel.send).toHaveBeenCalledOnce();
    });

    it.each([
        ['候補にない日時', () => {
            gameCandidateService.aggregate.mockResolvedValue({ game, month, candidates: [] });
        }, '対象の候補日程が見つかりません'],
        ['前日の候補', () => {
            candidate.localDate = '2026-08-22';
        }, '過去の候補日程では募集できません'],
        ['送信できないチャンネル', () => {
            channel.isSendable = () => false;
        }, 'ゲームチャンネルへメッセージを送信できません'],
        ['ロール不足', () => {
            guild.roles.cache.clear();
            guild.roles.fetch.mockResolvedValue(null);
        }, 'ゲームロールが見つかりません'],
        ['partyparrotの重複', () => {
            const duplicate = { ...confirmationEmoji, id: 'partyparrot-2' };
            guild.emojis.fetch.mockResolvedValue(new Collection([
                [EMOJI_ID, confirmationEmoji],
                [duplicate.id, duplicate]
            ]));
        }, 'サーバー内に一意な :partyparrot: 絵文字が必要です']
    ])('%sは予約前に拒否する', async (_name, arrange, expectedMessage) => {
        arrange();

        await expect(gameRecruitmentService.createRecruitment({
            guild,
            monthId: month.id,
            gameId: game.id,
            slotId: slot.id,
            userId: 'creator-1'
        })).rejects.toThrow(expectedMessage);

        expect(gameRecruitmentRepository.reserve).not.toHaveBeenCalled();
    });

    it('未来候補でも集計順の上位10件より後は募集できない', async () => {
        const candidates = Array.from({ length: 11 }, (_value, index) => ({
            ...candidate,
            slotId: 100 + index,
            startMinutes: 10 * 60 + index
        }));
        gameCandidateService.aggregate.mockResolvedValue({ game, month, candidates });

        await expect(gameRecruitmentService.createRecruitment({
            guild,
            monthId: month.id,
            gameId: game.id,
            slotId: candidates[10].slotId,
            userId: 'creator-1'
        })).rejects.toThrow('募集できる候補日程は上位10件までです');

        expect(gameRecruitmentRepository.reserve).not.toHaveBeenCalled();
    });

    it('送信失敗時は予約を解放する', async () => {
        channel.send.mockRejectedValue(new Error('send failed'));

        await expect(gameRecruitmentService.createRecruitment({
            guild,
            monthId: month.id,
            gameId: game.id,
            slotId: slot.id,
            userId: 'creator-1'
        })).rejects.toThrow('send failed');

        expect(gameRecruitmentRepository.release).toHaveBeenCalledWith(pendingRecruitment.id);
        expect(message.delete).not.toHaveBeenCalled();
    });

    it('同じ候補の重複は利用者向け募集エラーへ変換する', async () => {
        const conflict = new Error('このゲームと候補日程の募集はすでに作成されています');
        conflict.name = 'RecruitmentConflictError';
        gameRecruitmentRepository.reserve.mockImplementationOnce(() => {
            throw conflict;
        });

        await expect(gameRecruitmentService.createRecruitment({
            guild,
            monthId: month.id,
            gameId: game.id,
            slotId: slot.id,
            userId: 'creator-1'
        })).rejects.toMatchObject({
            name: 'GameRecruitmentError',
            message: conflict.message,
            cause: conflict
        });

        expect(channel.send).not.toHaveBeenCalled();
    });

    it('初期リアクション失敗時は予約を解放し、作成済みメッセージを削除する', async () => {
        message.react.mockRejectedValueOnce(new Error('reaction failed'));

        await expect(gameRecruitmentService.createRecruitment({
            guild,
            monthId: month.id,
            gameId: game.id,
            slotId: slot.id,
            userId: 'creator-1'
        })).rejects.toThrow('reaction failed');

        expect(gameRecruitmentRepository.release).toHaveBeenCalledWith(pendingRecruitment.id);
        expect(message.delete).toHaveBeenCalledOnce();
    });

    it('参加と参加不可の両方が押されたら後から押した側を残し、Botを除外して表示する', async () => {
        const participant = user('participant-1');
        const bot = user('bot-1', true);
        const attending = reactionFor(message, { name: ATTENDING_EMOJI, id: null }, [participant, bot]);
        const declining = reactionFor(message, { name: DECLINING_EMOJI, id: null }, [participant]);
        message.reactions.cache.set(ATTENDING_EMOJI, attending);
        message.reactions.cache.set(DECLINING_EMOJI, declining);

        const result = await gameRecruitmentService.handleReactionChange(attending, participant);

        expect(result).toEqual({ handled: true, confirmed: false });
        expect(declining.users.remove).toHaveBeenCalledWith(participant.id);
        expect(attending.users.fetch).toHaveBeenCalledOnce();
        expect(declining.users.fetch).toHaveBeenCalledOnce();
        const updated = message.edit.mock.calls[0][0];
        expect(updated.allowedMentions).toEqual({
            parse: [], roles: [], users: [], repliedUser: false
        });
        const updatedEmbed = embedJson(updated);
        expectDateOnlySchedule(updatedEmbed, '2026年8月24日（月）', '夜');
        expect(updatedEmbed.fields).toEqual(expect.arrayContaining([
            expect.objectContaining({
                name: `${ATTENDING_EMOJI} 参加者 (1人)`,
                value: '<@participant-1>'
            }),
            expect.objectContaining({
                name: `${DECLINING_EMOJI} 参加不可 (0人)`,
                value: 'なし'
            })
        ]));
    });

    it('リアクション削除では反対側を削除せず、最新一覧だけで更新する', async () => {
        const participant = user('participant-1');
        const attending = reactionFor(message, { name: ATTENDING_EMOJI, id: null }, []);
        const declining = reactionFor(message, { name: DECLINING_EMOJI, id: null }, [participant]);
        message.reactions.cache.set(ATTENDING_EMOJI, attending);
        message.reactions.cache.set(DECLINING_EMOJI, declining);

        await gameRecruitmentService.handleReactionChange(attending, participant, { removed: true });

        expect(declining.users.remove).not.toHaveBeenCalled();
        expect(embedJson(message.edit.mock.calls[0][0]).fields).toEqual(expect.arrayContaining([
            expect.objectContaining({
                name: `${DECLINING_EMOJI} 参加不可 (1人)`,
                value: '<@participant-1>'
            })
        ]));
    });

    it('参加表明中の本人は開催を確定し、候補日の12:00にリマインドを直接登録する', async () => {
        const participant = user('participant-1');
        const attending = reactionFor(message, { name: ATTENDING_EMOJI, id: null }, [participant]);
        const declining = reactionFor(message, { name: DECLINING_EMOJI, id: null }, []);
        const confirmation = reactionFor(
            message,
            { name: CONFIRMATION_EMOJI_NAME, id: EMOJI_ID },
            [participant]
        );
        message.reactions.cache.set(ATTENDING_EMOJI, attending);
        message.reactions.cache.set(DECLINING_EMOJI, declining);
        message.reactions.cache.set(EMOJI_ID, confirmation);

        const result = await gameRecruitmentService.handleReactionChange(confirmation, participant);

        expect(result).toEqual({
            handled: true,
            confirmed: true,
            reminder: { id: 'reminder-1' }
        });
        expect(guild.members.fetch).not.toHaveBeenCalled();
        expect(gameRecruitmentRepository.markConfirmed).toHaveBeenCalledWith(
            openRecruitment.id,
            participant.id
        );
        expect(reminderService.extractDate).not.toHaveBeenCalled();
        expect(reminderService.createReminder).toHaveBeenCalledWith(expect.objectContaining({
            guildId: GUILD_ID,
            channelId: CHANNEL_ID,
            messageId: MESSAGE_ID,
            remindAt: '2026-08-24T03:00:00.000Z',
            userId: participant.id
        }));
        const reminderPayload = reminderService.createReminder.mock.calls[0][0];
        expect(reminderPayload.originalContent).toContain('Apex Legends');
        expect(reminderPayload.originalContent).toContain('2026年8月24日（月）');
        expect(reminderPayload.originalContent).toContain('夜');
        expect(reminderPayload.originalContent)
            .not.toMatch(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/);
        expect(reminderPayload.remindAt).toBe('2026-08-24T03:00:00.000Z');
        expect(reminderService.createReminder).toHaveBeenCalledOnce();
        expect(gameRecruitmentRepository.setReminderId).toHaveBeenCalledWith(
            confirmedRecruitment.id,
            'reminder-1'
        );
        expect(embedJson(message.edit.mock.calls[0][0]).fields).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: '状態', value: '🎉 開催確定' })
        ]));
        expect(message.reply).toHaveBeenCalledWith({
            content: `<@&${ROLE_ID}> 開催が確定しました！`,
            allowedMentions: {
                parse: [], roles: [ROLE_ID], users: [], repliedUser: false
            }
        });
        expect(gameRecruitmentRepository.markConfirmed.mock.invocationCallOrder[0])
            .toBeLessThan(reminderService.createReminder.mock.invocationCallOrder[0]);
        expect(reminderService.createReminder.mock.invocationCallOrder[0])
            .toBeLessThan(gameRecruitmentRepository.setReminderId.mock.invocationCallOrder[0]);
        expect(gameRecruitmentRepository.setReminderId.mock.invocationCallOrder[0])
            .toBeLessThan(message.edit.mock.invocationCallOrder[0]);
    });

    it('確定embedの更新に失敗しても、リマインドとそのIDを先に登録する', async () => {
        const participant = user('participant-1');
        const attending = reactionFor(message, { name: ATTENDING_EMOJI, id: null }, [participant]);
        const declining = reactionFor(message, { name: DECLINING_EMOJI, id: null }, []);
        const confirmation = reactionFor(
            message,
            { name: CONFIRMATION_EMOJI_NAME, id: EMOJI_ID },
            [participant]
        );
        message.reactions.cache.set(ATTENDING_EMOJI, attending);
        message.reactions.cache.set(DECLINING_EMOJI, declining);
        message.edit.mockRejectedValue(new Error('edit failed'));

        await expect(gameRecruitmentService.handleReactionChange(confirmation, participant))
            .rejects.toThrow('edit failed');

        expect(reminderService.createReminder).toHaveBeenCalledOnce();
        expect(gameRecruitmentRepository.setReminderId).toHaveBeenCalledWith(
            confirmedRecruitment.id,
            'reminder-1'
        );
        expect(message.reply).not.toHaveBeenCalled();
        expect(gameRecruitmentRepository.setReminderId.mock.invocationCallOrder[0])
            .toBeLessThan(message.edit.mock.invocationCallOrder[0]);
    });

    it.each([
        ['Administrator', [PermissionFlagsBits.Administrator]],
        ['ManageGuild + ManageChannels', [
            PermissionFlagsBits.ManageGuild,
            PermissionFlagsBits.ManageChannels
        ]]
    ])('%s権限のメンバーは参加表明がなくても確定できる', async (_name, flags) => {
        const admin = user('admin-1');
        guild.members.cache.set(admin.id, {
            id: admin.id,
            permissions: new PermissionsBitField(flags)
        });
        const attending = reactionFor(message, { name: ATTENDING_EMOJI, id: null }, []);
        const declining = reactionFor(message, { name: DECLINING_EMOJI, id: null }, []);
        const confirmation = reactionFor(
            message,
            { name: CONFIRMATION_EMOJI_NAME, id: EMOJI_ID },
            [admin]
        );
        message.reactions.cache.set(ATTENDING_EMOJI, attending);
        message.reactions.cache.set(DECLINING_EMOJI, declining);

        await gameRecruitmentService.handleReactionChange(confirmation, admin);

        expect(gameRecruitmentRepository.markConfirmed).toHaveBeenCalledWith(
            openRecruitment.id,
            admin.id
        );
        expect(confirmation.users.remove).not.toHaveBeenCalled();
    });

    it('参加者でも管理権限者でもないメンバーの確定リアクションは外す', async () => {
        const outsider = user('outsider-1');
        guild.members.cache.set(outsider.id, {
            id: outsider.id,
            permissions: new PermissionsBitField()
        });
        const attending = reactionFor(message, { name: ATTENDING_EMOJI, id: null }, []);
        const declining = reactionFor(message, { name: DECLINING_EMOJI, id: null }, []);
        const confirmation = reactionFor(
            message,
            { name: CONFIRMATION_EMOJI_NAME, id: EMOJI_ID },
            [outsider]
        );
        message.reactions.cache.set(ATTENDING_EMOJI, attending);
        message.reactions.cache.set(DECLINING_EMOJI, declining);

        const result = await gameRecruitmentService.handleReactionChange(confirmation, outsider);

        expect(result).toEqual({ handled: true, confirmed: false, unauthorized: true });
        expect(confirmation.users.remove).toHaveBeenCalledWith(outsider.id);
        expect(gameRecruitmentRepository.markConfirmed).not.toHaveBeenCalled();
        expect(reminderService.createReminder).not.toHaveBeenCalled();
        expect(message.edit).not.toHaveBeenCalled();
        expect(message.reply).not.toHaveBeenCalled();
    });

    it('partyparrotを外しても確定とリマインドを取り消さない', async () => {
        const participant = user('participant-1');
        gameRecruitmentRepository.findByMessageId.mockReturnValue(confirmedRecruitment);
        gameRecruitmentRepository.findById.mockReturnValue(confirmedRecruitment);
        const confirmation = reactionFor(
            message,
            { name: CONFIRMATION_EMOJI_NAME, id: EMOJI_ID },
            []
        );

        const result = await gameRecruitmentService.handleReactionChange(
            confirmation,
            participant,
            { removed: true }
        );

        expect(result).toEqual({ handled: true, confirmed: true });
        expect(gameRecruitmentRepository.markConfirmed).not.toHaveBeenCalled();
        expect(reminderService.createReminder).not.toHaveBeenCalled();
        expect(message.edit).not.toHaveBeenCalled();
    });

    it('確定絵文字は名前が変更されても保存済みIDで判定する', async () => {
        const participant = user('participant-1');
        const attending = reactionFor(message, { name: ATTENDING_EMOJI, id: null }, [participant]);
        const declining = reactionFor(message, { name: DECLINING_EMOJI, id: null }, []);
        const renamedConfirmation = reactionFor(
            message,
            { name: 'renamed-parrot', id: EMOJI_ID },
            [participant]
        );
        message.reactions.cache.set(ATTENDING_EMOJI, attending);
        message.reactions.cache.set(DECLINING_EMOJI, declining);

        await gameRecruitmentService.handleReactionChange(renamedConfirmation, participant);

        expect(gameRecruitmentRepository.markConfirmed).toHaveBeenCalledWith(
            openRecruitment.id,
            participant.id
        );
        expect(reminderService.createReminder).toHaveBeenCalledOnce();
    });

    it('すでに確定済みなら二重にリマインドや確定通知を作らない', async () => {
        const participant = user('participant-1');
        const attending = reactionFor(message, { name: ATTENDING_EMOJI, id: null }, [participant]);
        const declining = reactionFor(message, { name: DECLINING_EMOJI, id: null }, []);
        const confirmation = reactionFor(
            message,
            { name: CONFIRMATION_EMOJI_NAME, id: EMOJI_ID },
            [participant]
        );
        message.reactions.cache.set(ATTENDING_EMOJI, attending);
        message.reactions.cache.set(DECLINING_EMOJI, declining);
        gameRecruitmentRepository.markConfirmed.mockReturnValue(null);

        await gameRecruitmentService.handleReactionChange(confirmation, participant);

        expect(reminderService.createReminder).not.toHaveBeenCalled();
        expect(gameRecruitmentRepository.setReminderId).not.toHaveBeenCalled();
        expect(message.reply).not.toHaveBeenCalled();
    });

    it('確定後も参加リアクションの変更を確定状態のまま更新する', async () => {
        const participant = user('participant-2');
        gameRecruitmentRepository.findByMessageId.mockReturnValue(confirmedRecruitment);
        gameRecruitmentRepository.findById.mockReturnValue(confirmedRecruitment);
        const attending = reactionFor(message, { name: ATTENDING_EMOJI, id: null }, [participant]);
        const declining = reactionFor(message, { name: DECLINING_EMOJI, id: null }, []);
        message.reactions.cache.set(ATTENDING_EMOJI, attending);
        message.reactions.cache.set(DECLINING_EMOJI, declining);

        await gameRecruitmentService.handleReactionChange(attending, participant);

        expect(embedJson(message.edit.mock.calls[0][0]).fields).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: '状態', value: '🎉 開催確定' }),
            expect.objectContaining({
                name: `${ATTENDING_EMOJI} 参加者 (1人)`,
                value: '<@participant-2>'
            })
        ]));
    });

    it('対象外メッセージ、無関係な絵文字、別IDのpartyparrot、Botは処理しない', async () => {
        const participant = user('participant-1');
        const unrelated = reactionFor(message, { name: '🎉', id: null }, [participant]);

        expect(await gameRecruitmentService.handleReactionChange(unrelated, participant))
            .toEqual({ handled: false });

        const externalParty = reactionFor(
            message,
            { name: CONFIRMATION_EMOJI_NAME, id: 'external-emoji' },
            [participant]
        );
        expect(await gameRecruitmentService.handleReactionChange(externalParty, participant))
            .toEqual({ handled: false });

        expect(await gameRecruitmentService.handleReactionChange(unrelated, user('bot-1', true)))
            .toEqual({ handled: false });

        gameRecruitmentRepository.findByMessageId.mockReturnValue(null);
        const attending = reactionFor(message, { name: ATTENDING_EMOJI, id: null }, [participant]);
        expect(await gameRecruitmentService.handleReactionChange(attending, participant))
            .toEqual({ handled: false });
        expect(message.edit).not.toHaveBeenCalled();
    });

    it('同じメッセージの並列イベントを1件ずつ順番に処理する', async () => {
        const participant = user('participant-1');
        const attending = reactionFor(message, { name: ATTENDING_EMOJI, id: null }, [participant]);
        let finishFirst;
        const firstPending = new Promise(resolve => {
            finishFirst = resolve;
        });
        const attendanceSpy = vi.spyOn(gameRecruitmentService, 'handleAttendanceChange')
            .mockImplementationOnce(() => firstPending)
            .mockResolvedValueOnce({ handled: true });

        const first = gameRecruitmentService.handleReactionChange(attending, participant);
        const second = gameRecruitmentService.handleReactionChange(attending, participant);
        await vi.waitFor(() => expect(attendanceSpy).toHaveBeenCalledTimes(1));

        finishFirst({ handled: true });
        await first;
        await second;

        expect(attendanceSpy).toHaveBeenCalledTimes(2);
        expect(gameRecruitmentService.messageQueues.size).toBe(0);
    });

    it('users.fetch待ち中に後発addが届いた場合は後から押した側を必ず残す', async () => {
        const participant = user('participant-1');
        const attendingUsers = userCollection(participant);
        const decliningUsers = userCollection(participant);
        let finishFirstFetch;
        const firstFetch = new Promise(resolve => {
            finishFirstFetch = resolve;
        });
        const attending = reactionFor(message, { name: ATTENDING_EMOJI, id: null }, [participant]);
        const declining = reactionFor(message, { name: DECLINING_EMOJI, id: null }, [participant]);
        attending.users.fetch
            .mockImplementationOnce(() => firstFetch)
            .mockImplementation(async () => attendingUsers);
        declining.users.fetch.mockImplementation(async () => decliningUsers);
        message.reactions.cache.set(ATTENDING_EMOJI, attending);
        message.reactions.cache.set(DECLINING_EMOJI, declining);

        const attendingTask = gameRecruitmentService.handleReactionChange(attending, participant);
        await vi.waitFor(() => expect(attending.users.fetch).toHaveBeenCalledOnce());
        const decliningTask = gameRecruitmentService.handleReactionChange(declining, participant);
        finishFirstFetch(attendingUsers);

        await attendingTask;
        await decliningTask;

        expect(declining.users.remove).not.toHaveBeenCalled();
        expect(attending.users.remove).toHaveBeenCalledOnce();
        expect(attending.users.remove).toHaveBeenCalledWith(participant.id);
        expect(message.edit).toHaveBeenCalledOnce();
        expect(embedJson(message.edit.mock.calls[0][0]).fields).toEqual(expect.arrayContaining([
            expect.objectContaining({
                name: `${ATTENDING_EMOJI} 参加者 (0人)`,
                value: 'なし'
            }),
            expect.objectContaining({
                name: `${DECLINING_EMOJI} 参加不可 (1人)`,
                value: '<@participant-1>'
            })
        ]));
        expect(gameRecruitmentService.latestAttendanceAdds.size).toBe(0);
    });
});

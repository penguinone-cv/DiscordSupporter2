import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import availabilityRepository from '../repositories/availabilityRepository.js';
import gameRecruitmentRepository from '../repositories/gameRecruitmentRepository.js';
import gameRepository from '../repositories/gameRepository.js';
import {
    currentDateKey,
    dateAtMinutesInTimeZone,
    formatDateLabel
} from '../utils/scheduleDate.js';
import logger from '../utils/logger.js';
import gameCandidateService from './gameCandidateService.js';
import reminderService from './reminderService.js';

const ATTENDING_EMOJI = '👍';
const DECLINING_EMOJI = '❌';
const CONFIRMATION_EMOJI_NAME = 'partyparrot';
const REMINDER_MINUTES = 12 * 60;
const EMBED_FIELD_VALUE_MAX = 1024;

class GameRecruitmentError extends Error {
    constructor(message, options = undefined) {
        super(message, options);
        this.name = 'GameRecruitmentError';
    }
}

function rejectRecruitment(message) {
    throw new GameRecruitmentError(message);
}

function valuesOf(collection) {
    if (!collection) return [];
    if (typeof collection.values === 'function') return [...collection.values()];
    return Array.isArray(collection) ? collection : [];
}

function humanUserIds(collection) {
    return valuesOf(collection)
        .filter(item => item?.id && item.bot !== true)
        .map(item => item.id)
        .sort((left, right) => left.localeCompare(right));
}

function hasUser(collection, userId) {
    if (!collection) return false;
    if (typeof collection.has === 'function') return collection.has(userId);
    return valuesOf(collection).some(item => item?.id === userId);
}

function deleteUserLocally(collection, userId) {
    if (typeof collection?.delete === 'function') collection.delete(userId);
}

function findReaction(message, emojiName) {
    const reactions = message?.reactions?.cache;
    if (!reactions) return null;
    if (typeof reactions.find === 'function') {
        return reactions.find(item => item.emoji?.name === emojiName) ?? null;
    }
    return valuesOf(reactions).find(item => item.emoji?.name === emojiName) ?? null;
}

async function fetchManagerEntry(manager, id) {
    const cached = manager?.cache?.get?.(id);
    if (cached) return cached;
    if (typeof manager?.fetch === 'function') return await manager.fetch(id);
    return null;
}

function isSendable(channel) {
    return Boolean(channel)
        && typeof channel.send === 'function'
        && (typeof channel.isSendable !== 'function' || channel.isSendable());
}

function slotSummary(slot) {
    return `${formatDateLabel(slot.local_date, { includeYear: true })} (${slot.label})`;
}

function mentionList(ids) {
    if (ids.length === 0) return 'なし';

    let output = '';
    for (let index = 0; index < ids.length; index += 1) {
        const mention = `<@${ids[index]}>`;
        const candidate = output ? `${output}\n${mention}` : mention;
        const remaining = ids.length - index - 1;
        const suffix = remaining > 0 ? `\n…ほか${remaining}人` : '';
        if (candidate.length + suffix.length > EMBED_FIELD_VALUE_MAX) {
            const unlisted = ids.length - index;
            return `${output}\n…ほか${unlisted}人`;
        }
        output = candidate;
    }
    return output;
}

class GameRecruitmentService {
    constructor() {
        this.messageQueues = new Map();
        this.latestAttendanceAdds = new Map();
        this.attendanceSequence = 0;
    }

    buildEmbed({ game, slot, status = 'open', attendingIds = [], decliningIds = [] }) {
        return new EmbedBuilder()
            .setColor(status === 'confirmed' ? 0x57F287 : 0x5865F2)
            .setTitle(`🎮 ${game.display_name} 参加募集`)
            .setDescription([
                `**開催日:** ${formatDateLabel(slot.local_date, { includeYear: true })}`,
                `**時間枠:** ${slot.label}`,
                '',
                `${ATTENDING_EMOJI} 参加表明 / ${DECLINING_EMOJI} 参加不可 / :${CONFIRMATION_EMOJI_NAME}: 開催確定`
            ].join('\n'))
            .addFields(
                {
                    name: '状態',
                    value: status === 'confirmed' ? '🎉 開催確定' : '🟢 募集中',
                    inline: false
                },
                {
                    name: `${ATTENDING_EMOJI} 参加者 (${attendingIds.length}人)`,
                    value: mentionList(attendingIds),
                    inline: true
                },
                {
                    name: `${DECLINING_EMOJI} 参加不可 (${decliningIds.length}人)`,
                    value: mentionList(decliningIds),
                    inline: true
                }
            );
    }

    async uniqueConfirmationEmoji(guild) {
        const emojis = typeof guild.emojis?.fetch === 'function'
            ? await guild.emojis.fetch()
            : guild.emojis?.cache;
        const matches = valuesOf(emojis)
            .filter(emoji => emoji?.name === CONFIRMATION_EMOJI_NAME
                && (!emoji.guild?.id || emoji.guild.id === guild.id));
        if (matches.length !== 1) {
            rejectRecruitment(`サーバー内に一意な :${CONFIRMATION_EMOJI_NAME}: 絵文字が必要です`);
        }
        return matches[0];
    }

    async createRecruitment({ guild, monthId, gameId, slotId, userId }) {
        if (!guild?.id) rejectRecruitment('対象のサーバーが見つかりません');
        if (!userId) rejectRecruitment('募集作成者が特定できません');

        const aggregated = await gameCandidateService.aggregate(guild, monthId, gameId);
        const { game, month } = aggregated;
        if (!game
            || String(game.id) !== String(gameId)
            || game.guild_id !== guild.id
            || game.lifecycle_status !== 'active'
            || !game.current_channel_id) {
            rejectRecruitment('対象の稼働中ゲームが見つかりません');
        }
        if (!month
            || String(month.id) !== String(monthId)
            || month.guild_id && month.guild_id !== guild.id
            || !month.timezone) {
            rejectRecruitment('対象の月間予定が見つかりません');
        }
        const slot = aggregated.candidates.find(candidate => String(candidate.slotId) === String(slotId));
        if (!slot) rejectRecruitment('対象の候補日程が見つかりません');

        const today = currentDateKey(new Date(), month.timezone);
        if (slot.localDate < today) {
            rejectRecruitment('過去の候補日程では募集できません');
        }
        const topEligibleCandidates = aggregated.candidates
            .filter(candidate => candidate.localDate >= today)
            .slice(0, 10);
        if (!topEligibleCandidates.some(candidate => String(candidate.slotId) === String(slotId))) {
            rejectRecruitment('募集できる候補日程は上位10件までです');
        }

        const channel = await fetchManagerEntry(guild.channels, game.current_channel_id);
        if (!isSendable(channel) || channel.guild?.id && channel.guild.id !== guild.id) {
            rejectRecruitment('ゲームチャンネルへメッセージを送信できません');
        }
        if (!game.current_role_id) rejectRecruitment('ゲームロールが設定されていません');
        const role = await fetchManagerEntry(guild.roles, game.current_role_id);
        if (!role || role.guild?.id && role.guild.id !== guild.id) {
            rejectRecruitment('ゲームロールが見つかりません');
        }
        const confirmationEmoji = await this.uniqueConfirmationEmoji(guild);

        let reservation = null;
        let message = null;
        try {
            reservation = await gameRecruitmentRepository.reserve({
                guildId: guild.id,
                gameId: game.id,
                slotId: slot.slotId,
                channelId: channel.id,
                roleId: role.id,
                creatorUserId: userId
            });
            message = await channel.send({
                content: `<@&${role.id}>`,
                embeds: [this.buildEmbed({
                    game,
                    slot: {
                        local_date: slot.localDate,
                        label: slot.label,
                        start_minutes: slot.startMinutes,
                        end_minutes: slot.endMinutes
                    }
                })],
                allowedMentions: { parse: [], roles: [role.id], users: [] }
            });
            const recruitment = await gameRecruitmentRepository.activate(reservation.id, {
                messageId: message.id,
                confirmationEmojiId: confirmationEmoji.id
            });
            if (!recruitment) throw new Error('募集メッセージを有効化できません');

            await message.react(ATTENDING_EMOJI);
            await message.react(DECLINING_EMOJI);
            await message.react(confirmationEmoji);
            return { recruitment, message };
        } catch (error) {
            if (reservation) {
                try {
                    await gameRecruitmentRepository.release(reservation.id);
                } catch (releaseError) {
                    logger.error('募集予約の解放に失敗しました:', releaseError);
                }
            }
            if (message && message.deletable !== false && typeof message.delete === 'function') {
                try {
                    await message.delete();
                } catch (deleteError) {
                    logger.error('不完全な募集メッセージの削除に失敗しました:', deleteError);
                }
            }
            if (error?.name === 'RecruitmentConflictError') {
                throw new GameRecruitmentError(error.message, { cause: error });
            }
            throw error;
        }
    }

    enqueue(messageId, task) {
        const previous = this.messageQueues.get(messageId) ?? Promise.resolve();
        const operation = previous.catch(() => undefined).then(task);
        let tracked;
        tracked = operation.finally(() => {
            if (this.messageQueues.get(messageId) === tracked) this.messageQueues.delete(messageId);
        });
        this.messageQueues.set(messageId, tracked);
        return tracked;
    }

    recordAttendanceAdd(messageId, userId, emojiName) {
        const key = `${messageId}:${userId}`;
        const event = { key, sequence: ++this.attendanceSequence, emojiName };
        this.latestAttendanceAdds.set(key, event);
        return event;
    }

    isSupersededAttendanceAdd(event) {
        if (!event) return false;
        return this.latestAttendanceAdds.get(event.key)?.sequence !== event.sequence;
    }

    finishAttendanceAdd(event) {
        if (event && this.latestAttendanceAdds.get(event.key)?.sequence === event.sequence) {
            this.latestAttendanceAdds.delete(event.key);
        }
    }

    async reactionUsers(reaction) {
        if (!reaction?.users || typeof reaction.users.fetch !== 'function') return new Map();
        return await reaction.users.fetch();
    }

    loadContext(recruitment) {
        const game = gameRepository.findById(recruitment.game_id);
        const slot = availabilityRepository.findUserSlot(
            recruitment.guild_id,
            recruitment.creator_user_id,
            recruitment.slot_id
        );
        const month = slot
            ? availabilityRepository.findMonthById(recruitment.guild_id, slot.month_id)
            : null;
        if (!game || !slot || !month) throw new Error('募集の候補日程を取得できません');
        return { game, slot, month };
    }

    async latestResponses(message, currentReaction = null) {
        const attendingReaction = currentReaction?.emoji?.name === ATTENDING_EMOJI
            ? currentReaction
            : findReaction(message, ATTENDING_EMOJI);
        const decliningReaction = currentReaction?.emoji?.name === DECLINING_EMOJI
            ? currentReaction
            : findReaction(message, DECLINING_EMOJI);
        const [attendingUsers, decliningUsers] = await Promise.all([
            this.reactionUsers(attendingReaction),
            this.reactionUsers(decliningReaction)
        ]);
        return { attendingReaction, decliningReaction, attendingUsers, decliningUsers };
    }

    async canConfirm(guild, user, attendingUsers) {
        if (hasUser(attendingUsers, user.id)) return true;
        const member = await fetchManagerEntry(guild.members, user.id);
        const permissions = member?.permissions;
        if (!permissions?.has) return false;
        return permissions.has(PermissionFlagsBits.Administrator)
            || (
                permissions.has(PermissionFlagsBits.ManageGuild)
                && permissions.has(PermissionFlagsBits.ManageChannels)
            );
    }

    async updateMessage(message, recruitment, responses) {
        const { game, slot, month } = this.loadContext(recruitment);
        await message.edit({
            embeds: [this.buildEmbed({
                game,
                slot,
                status: recruitment.status,
                attendingIds: humanUserIds(responses.attendingUsers),
                decliningIds: humanUserIds(responses.decliningUsers)
            })],
            allowedMentions: { parse: [], roles: [], users: [], repliedUser: false }
        });
        return { game, slot, month };
    }

    async handleAttendanceChange(reaction, user, recruitment, removed, attendanceEvent = null) {
        const message = reaction.message;
        const responses = await this.latestResponses(message, reaction);
        // users.fetch() 中に同じ人の後発addが到着した場合、古い側では
        // 反対リアクションを外さず、後発タスクに最新状態の集計を任せる。
        if (this.isSupersededAttendanceAdd(attendanceEvent)) {
            return { handled: true, confirmed: recruitment.status === 'confirmed' };
        }
        const isAttending = reaction.emoji.name === ATTENDING_EMOJI;
        const currentUsers = isAttending ? responses.attendingUsers : responses.decliningUsers;
        const oppositeReaction = isAttending
            ? responses.decliningReaction
            : responses.attendingReaction;
        const oppositeUsers = isAttending
            ? responses.decliningUsers
            : responses.attendingUsers;

        if (!removed && hasUser(currentUsers, user.id) && hasUser(oppositeUsers, user.id)) {
            await oppositeReaction?.users?.remove?.(user.id);
            deleteUserLocally(oppositeUsers, user.id);
        }
        await this.updateMessage(message, recruitment, responses);
        return { handled: true, confirmed: recruitment.status === 'confirmed' };
    }

    async handleConfirmation(reaction, user, recruitment, removed) {
        if (removed) return { handled: true, confirmed: recruitment.status === 'confirmed' };

        const message = reaction.message;
        const responses = await this.latestResponses(message);
        if (!await this.canConfirm(message.guild, user, responses.attendingUsers)) {
            await reaction.users?.remove?.(user.id);
            return {
                handled: true,
                confirmed: recruitment.status === 'confirmed',
                unauthorized: true
            };
        }

        const confirmed = await gameRecruitmentRepository.markConfirmed(recruitment.id, user.id);
        if (!confirmed) {
            const current = await gameRecruitmentRepository.findById(recruitment.id);
            return { handled: true, confirmed: current?.status === 'confirmed' };
        }

        const { game, slot, month } = this.loadContext(confirmed);
        const remindAt = dateAtMinutesInTimeZone(
            slot.local_date,
            REMINDER_MINUTES,
            month.timezone
        ).toISOString();
        const reminder = await reminderService.createReminder({
            guildId: confirmed.guild_id,
            channelId: confirmed.channel_id,
            messageId: confirmed.message_id,
            originalContent: `${game.display_name}の開催予定（${slotSummary(slot)}）`,
            remindAt,
            userId: user.id
        });
        await gameRecruitmentRepository.setReminderId(confirmed.id, reminder.id);
        await this.updateMessage(message, confirmed, responses);
        await message.reply({
            content: `<@&${confirmed.role_id}> 開催が確定しました！`,
            allowedMentions: {
                parse: [],
                roles: [confirmed.role_id],
                users: [],
                repliedUser: false
            }
        });
        return { handled: true, confirmed: true, reminder };
    }

    async handleReactionChange(reaction, user, { removed = false } = {}) {
        if (!reaction || !user || user.bot) return { handled: false };
        if (reaction.partial && typeof reaction.fetch === 'function') await reaction.fetch();

        const message = reaction.message;
        if (!message?.id || !message.guild) return { handled: false };
        const recruitment = await gameRecruitmentRepository.findByMessageId(message.id);
        if (!recruitment
            || !['open', 'confirmed'].includes(recruitment.status)
            || recruitment.guild_id !== message.guild.id
            || recruitment.channel_id !== message.channelId && recruitment.channel_id !== message.channel?.id) {
            return { handled: false };
        }

        const emojiName = reaction.emoji?.name;
        const isAttendance = emojiName === ATTENDING_EMOJI || emojiName === DECLINING_EMOJI;
        const isConfirmation = Boolean(reaction.emoji?.id)
            && reaction.emoji.id === recruitment.confirmation_emoji_id;
        if (!isAttendance && !isConfirmation) return { handled: false };

        const attendanceEvent = isAttendance && !removed
            ? this.recordAttendanceAdd(message.id, user.id, emojiName)
            : null;

        return await this.enqueue(message.id, async () => {
            try {
                // 待ち行列の間に確定された場合も最新の状態を使う。
                const latest = await gameRecruitmentRepository.findById(recruitment.id) ?? recruitment;
                if (isAttendance) {
                    return await this.handleAttendanceChange(
                        reaction,
                        user,
                        latest,
                        removed,
                        attendanceEvent
                    );
                }
                return await this.handleConfirmation(reaction, user, latest, removed);
            } finally {
                this.finishAttendanceAdd(attendanceEvent);
            }
        });
    }
}

export {
    ATTENDING_EMOJI,
    CONFIRMATION_EMOJI_NAME,
    DECLINING_EMOJI,
    GameRecruitmentError,
    GameRecruitmentService,
    REMINDER_MINUTES
};
export default new GameRecruitmentService();

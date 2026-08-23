import database from './database.js';

function nowIso() {
    return new Date().toISOString();
}

export const RecruitmentConflictCode = Object.freeze({
    GAME_SLOT_ALREADY_RESERVED: 'GAME_SLOT_ALREADY_RESERVED',
    MESSAGE_ALREADY_LINKED: 'MESSAGE_ALREADY_LINKED'
});

export class RecruitmentConflictError extends Error {
    constructor(code, message, options = undefined) {
        super(message, options);
        this.name = 'RecruitmentConflictError';
        this.code = code;
    }
}

function throwMappedConflict(error) {
    if (error?.code !== 'SQLITE_CONSTRAINT_UNIQUE') throw error;

    const detail = String(error.message);
    if (detail.includes('game_recruitments.game_id')
        && detail.includes('game_recruitments.slot_id')) {
        throw new RecruitmentConflictError(
            RecruitmentConflictCode.GAME_SLOT_ALREADY_RESERVED,
            'このゲームと候補日時の募集はすでに作成されています',
            { cause: error }
        );
    }
    if (detail.includes('game_recruitments.message_id')) {
        throw new RecruitmentConflictError(
            RecruitmentConflictCode.MESSAGE_ALREADY_LINKED,
            'このDiscordメッセージは別の募集に紐付いています',
            { cause: error }
        );
    }
    throw error;
}

class GameRecruitmentRepository {
    reserve({ guildId, gameId, slotId, channelId, roleId, creatorUserId }) {
        const now = nowIso();
        try {
            const result = database.connection().prepare(`
                INSERT INTO game_recruitments (
                    guild_id, game_id, slot_id, channel_id, role_id,
                    creator_user_id, status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
            `).run(
                guildId,
                gameId,
                slotId,
                channelId,
                roleId,
                creatorUserId,
                now,
                now
            );
            return this.findById(Number(result.lastInsertRowid));
        } catch (error) {
            throwMappedConflict(error);
        }
    }

    activate(id, { messageId, confirmationEmojiId }) {
        let result;
        try {
            result = database.connection().prepare(`
                UPDATE game_recruitments
                SET message_id = ?, confirmation_emoji_id = ?,
                    status = 'open', updated_at = ?
                WHERE id = ? AND status = 'pending'
            `).run(messageId, confirmationEmojiId, nowIso(), id);
        } catch (error) {
            throwMappedConflict(error);
        }
        return result.changes === 1 ? this.findById(id) : null;
    }

    remove(id) {
        const result = database.connection().prepare(`
            DELETE FROM game_recruitments
            WHERE id = ? AND status = 'pending'
        `).run(id);
        return result.changes === 1;
    }

    release(id) {
        const result = database.connection().prepare(`
            DELETE FROM game_recruitments
            WHERE id = ?
              AND status IN ('pending', 'open')
              AND reminder_id IS NULL
        `).run(id);
        return result.changes === 1;
    }

    findById(id) {
        if (!database.isInitialized || !id) return null;
        return database.connection().prepare(`
            SELECT * FROM game_recruitments WHERE id = ?
        `).get(id) ?? null;
    }

    findByMessageId(messageId) {
        if (!database.isInitialized || !messageId) return null;
        return database.connection().prepare(`
            SELECT * FROM game_recruitments WHERE message_id = ?
        `).get(messageId) ?? null;
    }

    findByGameSlot(gameId, slotId) {
        if (!database.isInitialized || !gameId || !slotId) return null;
        return database.connection().prepare(`
            SELECT * FROM game_recruitments
            WHERE game_id = ? AND slot_id = ?
        `).get(gameId, slotId) ?? null;
    }

    markConfirmed(id, userId) {
        const now = nowIso();
        const result = database.connection().prepare(`
            UPDATE game_recruitments
            SET status = 'confirmed', confirmed_by_user_id = ?,
                confirmed_at = ?, updated_at = ?
            WHERE id = ? AND status = 'open'
        `).run(userId, now, now, id);
        return result.changes === 1 ? this.findById(id) : null;
    }

    setReminderId(id, reminderId) {
        const result = database.connection().prepare(`
            UPDATE game_recruitments
            SET reminder_id = ?, updated_at = ?
            WHERE id = ?
              AND status = 'confirmed'
              AND reminder_id IS NULL
        `).run(reminderId, nowIso(), id);
        return result.changes === 1 ? this.findById(id) : null;
    }
}

export default new GameRecruitmentRepository();

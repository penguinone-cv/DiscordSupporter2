import database from './database.js';

function nowIso() {
    return new Date().toISOString();
}

class GameRepository {
    findById(gameId) {
        if (!database.isInitialized) return null;
        return database.connection().prepare('SELECT * FROM games WHERE id = ?').get(gameId) ?? null;
    }

    findByChannelId(channelId) {
        if (!database.isInitialized || !channelId) return null;
        return database.connection().prepare(`
            SELECT g.*, gc.id AS game_channel_id, gc.channel_name, gc.parent_category_id,
                   gc.active_from, gc.active_until
            FROM games g
            JOIN game_channels gc ON gc.game_id = g.id
            WHERE gc.channel_id = ? AND gc.active_until IS NULL
        `).get(channelId) ?? null;
    }

    findActiveByChannelId(channelId) {
        const game = this.findByChannelId(channelId);
        return game?.lifecycle_status === 'active' ? game : null;
    }

    registerChannel({ guildId, channelId, channelName, parentCategoryId, roleId = null, activeFrom }) {
        const existing = this.findByChannelId(channelId);
        const now = nowIso();
        if (existing) {
            database.transaction(() => {
                database.connection().prepare(`
                    UPDATE game_channels
                    SET channel_name = ?, parent_category_id = ?
                    WHERE id = ?
                `).run(channelName, parentCategoryId, existing.game_channel_id);
                database.connection().prepare(`
                    UPDATE games
                    SET display_name = ?, normalized_name = ?,
                        current_role_id = COALESCE(?, current_role_id), updated_at = ?
                    WHERE id = ?
                `).run(channelName, normalizeGameName(channelName), roleId, now, existing.id);
            })();
            return this.findById(existing.id);
        }

        return database.transaction(() => {
            const gameResult = database.connection().prepare(`
                INSERT INTO games (
                    guild_id, display_name, normalized_name, lifecycle_status,
                    current_channel_id, current_role_id, created_at, updated_at
                ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?)
            `).run(guildId, channelName, normalizeGameName(channelName), channelId, roleId, now, now);
            const gameId = Number(gameResult.lastInsertRowid);
            const channelResult = database.connection().prepare(`
                INSERT INTO game_channels (
                    game_id, channel_id, channel_name, parent_category_id, active_from
                ) VALUES (?, ?, ?, ?, ?)
            `).run(gameId, channelId, channelName, parentCategoryId, activeFrom ?? now);
            database.connection().prepare(`
                INSERT INTO game_channel_activity (game_channel_id, updated_at)
                VALUES (?, ?)
            `).run(Number(channelResult.lastInsertRowid), now);
            return this.findById(gameId);
        })();
    }

    updateChannelMetadata(channelId, { channelName, parentCategoryId }) {
        const game = this.findByChannelId(channelId);
        if (!game) return null;
        const now = nowIso();
        database.transaction(() => {
            database.connection().prepare(`
                UPDATE game_channels SET channel_name = ?, parent_category_id = ? WHERE id = ?
            `).run(channelName, parentCategoryId, game.game_channel_id);
            database.connection().prepare(`
                UPDATE games SET display_name = ?, normalized_name = ?, updated_at = ? WHERE id = ?
            `).run(channelName, normalizeGameName(channelName), now, game.id);
        })();
        return this.findById(game.id);
    }

    detachChannel(channelId, reason = 'channel_deleted') {
        const game = this.findByChannelId(channelId);
        if (!game) return null;
        const now = nowIso();
        database.transaction(() => {
            database.connection().prepare(`
                UPDATE game_channels SET active_until = ?, detach_reason = ? WHERE id = ?
            `).run(now, reason, game.game_channel_id);
            database.connection().prepare(`
                UPDATE games SET current_channel_id = NULL, updated_at = ? WHERE id = ?
            `).run(now, game.id);
        })();
        return this.findById(game.id);
    }

    setRole(gameId, roleId) {
        database.connection().prepare(`
            UPDATE games SET current_role_id = ?, updated_at = ? WHERE id = ?
        `).run(roleId, nowIso(), gameId);
        return this.findById(gameId);
    }

    setArchived(gameId) {
        const now = nowIso();
        database.connection().prepare(`
            UPDATE games
            SET lifecycle_status = 'archived', archived_at = ?, updated_at = ?
            WHERE id = ?
        `).run(now, now, gameId);
        return this.findById(gameId);
    }

    setActive(gameId) {
        database.connection().prepare(`
            UPDATE games
            SET lifecycle_status = 'active', archived_at = NULL, updated_at = ?
            WHERE id = ?
        `).run(nowIso(), gameId);
        return this.findById(gameId);
    }

    setArchiveExcluded(gameId, excluded) {
        database.connection().prepare(`
            UPDATE games SET archive_excluded = ?, updated_at = ? WHERE id = ?
        `).run(excluded ? 1 : 0, nowIso(), gameId);
        return this.findById(gameId);
    }

    listByGuild(guildId, status = null) {
        if (!database.isInitialized) return [];
        if (status) {
            return database.connection().prepare(`
                SELECT * FROM games WHERE guild_id = ? AND lifecycle_status = ? ORDER BY display_name
            `).all(guildId, status);
        }
        return database.connection().prepare(`
            SELECT * FROM games WHERE guild_id = ? ORDER BY display_name
        `).all(guildId);
    }

    counts(guildId) {
        if (!database.isInitialized) return { active: 0, archived: 0, missing: 0 };
        const rows = database.connection().prepare(`
            SELECT lifecycle_status, COUNT(*) AS count
            FROM games WHERE guild_id = ? GROUP BY lifecycle_status
        `).all(guildId);
        const counts = { active: 0, archived: 0, missing: 0 };
        for (const row of rows) counts[row.lifecycle_status] = row.count;
        counts.missing = database.connection().prepare(`
            SELECT COUNT(*) AS count FROM games WHERE guild_id = ? AND current_channel_id IS NULL
        `).get(guildId).count;
        return counts;
    }
}

export function normalizeGameName(name) {
    return name.normalize('NFKC').trim().toLocaleLowerCase('ja-JP').replace(/[\s_]+/g, '-');
}

export default new GameRepository();


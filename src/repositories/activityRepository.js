import database from './database.js';

class ActivityRepository {
    record(channelId, { anyAt, userAt = null, userId = null }) {
        if (!database.isInitialized) return null;
        const game = database.connection().prepare(`
            SELECT gc.id AS game_channel_id
            FROM game_channels gc
            WHERE gc.channel_id = ? AND gc.active_until IS NULL
        `).get(channelId);
        if (!game) return null;
        const now = new Date().toISOString();
        database.connection().prepare(`
            INSERT INTO game_channel_activity (
                game_channel_id, last_user_message_at, last_user_id,
                last_any_message_at, reconciliation_status, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(game_channel_id) DO UPDATE SET
                last_any_message_at = CASE
                    WHEN game_channel_activity.last_any_message_at IS NULL
                         OR excluded.last_any_message_at > game_channel_activity.last_any_message_at
                    THEN excluded.last_any_message_at ELSE game_channel_activity.last_any_message_at END,
                last_user_message_at = CASE
                    WHEN excluded.last_user_message_at IS NOT NULL
                         AND (game_channel_activity.last_user_message_at IS NULL
                              OR excluded.last_user_message_at > game_channel_activity.last_user_message_at)
                    THEN excluded.last_user_message_at ELSE game_channel_activity.last_user_message_at END,
                last_user_id = CASE
                    WHEN excluded.last_user_message_at IS NOT NULL
                         AND (game_channel_activity.last_user_message_at IS NULL
                              OR excluded.last_user_message_at >= game_channel_activity.last_user_message_at)
                    THEN excluded.last_user_id ELSE game_channel_activity.last_user_id END,
                reconciliation_status = CASE
                    WHEN excluded.last_user_message_at IS NOT NULL THEN 'confirmed'
                    ELSE game_channel_activity.reconciliation_status END,
                updated_at = excluded.updated_at
        `).run(game.game_channel_id, userAt, userId, anyAt, userAt ? 'confirmed' : 'unknown', now);
        return this.findByChannelId(channelId);
    }

    markReconciled(channelId, { lastUserMessageAt = null, lastUserId = null, confirmed }) {
        if (!database.isInitialized) return null;
        const mapping = database.connection().prepare(`
            SELECT id FROM game_channels WHERE channel_id = ? AND active_until IS NULL
        `).get(channelId);
        if (!mapping) return null;
        const now = new Date().toISOString();
        database.connection().prepare(`
            INSERT INTO game_channel_activity (
                game_channel_id, last_user_message_at, last_user_id,
                last_reconciled_at, reconciliation_status, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(game_channel_id) DO UPDATE SET
                last_user_message_at = CASE
                    WHEN excluded.last_user_message_at IS NOT NULL
                         AND (game_channel_activity.last_user_message_at IS NULL
                              OR excluded.last_user_message_at > game_channel_activity.last_user_message_at)
                    THEN excluded.last_user_message_at ELSE game_channel_activity.last_user_message_at END,
                last_user_id = CASE
                    WHEN excluded.last_user_message_at IS NOT NULL THEN excluded.last_user_id
                    ELSE game_channel_activity.last_user_id END,
                last_reconciled_at = excluded.last_reconciled_at,
                reconciliation_status = excluded.reconciliation_status,
                updated_at = excluded.updated_at
        `).run(
            mapping.id,
            lastUserMessageAt,
            lastUserId,
            now,
            confirmed ? 'confirmed' : 'unknown',
            now
        );
        return this.findByChannelId(channelId);
    }

    findByChannelId(channelId) {
        if (!database.isInitialized) return null;
        return database.connection().prepare(`
            SELECT a.*, gc.channel_id
            FROM game_channel_activity a
            JOIN game_channels gc ON gc.id = a.game_channel_id
            WHERE gc.channel_id = ? AND gc.active_until IS NULL
        `).get(channelId) ?? null;
    }

    defer(gameId, until, userId, reason = null) {
        const now = new Date().toISOString();
        database.connection().prepare(`
            INSERT INTO game_archive_deferrals (game_id, deferred_until, deferred_by, reason, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(game_id) DO UPDATE SET
                deferred_until = excluded.deferred_until,
                deferred_by = excluded.deferred_by,
                reason = excluded.reason,
                updated_at = excluded.updated_at
        `).run(gameId, until, userId, reason, now);
    }

    listDormantCandidates(guildId, cutoff) {
        if (!database.isInitialized) return [];
        return database.connection().prepare(`
            SELECT g.*, gc.channel_name, gc.active_from,
                   a.last_user_message_at, a.last_user_id, a.reconciliation_status
            FROM games g
            JOIN game_channels gc
              ON gc.game_id = g.id AND gc.active_until IS NULL
            JOIN game_channel_activity a ON a.game_channel_id = gc.id
            LEFT JOIN game_archive_deferrals d ON d.game_id = g.id
            WHERE g.guild_id = ?
              AND g.lifecycle_status = 'active'
              AND g.current_channel_id IS NOT NULL
              AND g.archive_excluded = 0
              AND a.reconciliation_status = 'confirmed'
              AND (d.deferred_until IS NULL OR d.deferred_until <= ?)
              AND (
                    (a.last_user_message_at IS NOT NULL AND a.last_user_message_at < ?)
                    OR (a.last_user_message_at IS NULL AND gc.active_from < ?)
                  )
              AND NOT EXISTS (
                    SELECT 1 FROM game_archive_operations op
                    WHERE op.game_id = g.id
                      AND op.status IN ('in_progress', 'manual_attention')
                  )
            ORDER BY COALESCE(a.last_user_message_at, gc.active_from) ASC
        `).all(guildId, new Date().toISOString(), cutoff, cutoff);
    }
}

export default new ActivityRepository();


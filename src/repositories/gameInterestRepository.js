import database from './database.js';

function nowIso() {
    return new Date().toISOString();
}

class GameInterestRepository {
    listActivePreferenceGames(guildId, userId) {
        if (!database.isInitialized) return [];
        return database.connection().prepare(`
            SELECT g.*,
                   CASE WHEN preference.game_id IS NULL THEN 0 ELSE 1 END AS preferred
            FROM games g
            LEFT JOIN user_game_preferences preference
              ON preference.guild_id = g.guild_id
             AND preference.user_id = ?
             AND preference.game_id = g.id
            WHERE g.guild_id = ?
              AND g.lifecycle_status = 'active'
              AND g.current_channel_id IS NOT NULL
            ORDER BY g.display_name, g.id
        `).all(userId, guildId);
    }

    replacePreferencesForGames({ guildId, userId, gameIds, preferredGameIds }) {
        const scopedIds = [...new Set(gameIds.map(Number))];
        const preferredIds = [...new Set(preferredGameIds.map(Number))];
        if (scopedIds.some(id => !Number.isSafeInteger(id) || id <= 0)
            || preferredIds.some(id => !Number.isSafeInteger(id) || id <= 0)) {
            throw new Error('ゲーム希望に不正なゲームIDが含まれています');
        }

        const scopedIdSet = new Set(scopedIds);
        if (preferredIds.some(id => !scopedIdSet.has(id))) {
            throw new Error('編集対象外のゲームは選択できません');
        }
        if (!scopedIds.length) return { updated: 0, selected: 0 };

        return database.transaction(() => {
            const placeholders = scopedIds.map(() => '?').join(', ');
            const validGames = database.connection().prepare(`
                SELECT id
                FROM games
                WHERE guild_id = ?
                  AND lifecycle_status = 'active'
                  AND current_channel_id IS NOT NULL
                  AND id IN (${placeholders})
            `).all(guildId, ...scopedIds);
            if (validGames.length !== scopedIds.length) {
                throw new Error('編集対象のゲーム一覧が更新されました。もう一度開き直してください');
            }

            const preferredIdSet = new Set(preferredIds);
            const remove = database.connection().prepare(`
                DELETE FROM user_game_preferences
                WHERE guild_id = ? AND user_id = ? AND game_id = ?
            `);
            const upsert = database.connection().prepare(`
                INSERT INTO user_game_preferences (
                    guild_id, user_id, game_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(guild_id, user_id, game_id) DO UPDATE SET
                    updated_at = excluded.updated_at
            `);
            const now = nowIso();
            for (const gameId of scopedIds) {
                if (preferredIdSet.has(gameId)) {
                    upsert.run(guildId, userId, gameId, now, now);
                } else {
                    remove.run(guildId, userId, gameId);
                }
            }
            return { updated: scopedIds.length, selected: preferredIds.length };
        })();
    }

    findCurrentArchivedGame(guildId, gameId) {
        if (!database.isInitialized) return null;
        return database.connection().prepare(`
            SELECT g.*, s.id AS archive_snapshot_id,
                   (
                       SELECT COUNT(*)
                       FROM game_restore_requests r
                       WHERE r.archive_snapshot_id = s.id
                   ) AS restore_request_count
            FROM games g
            LEFT JOIN game_archive_snapshots s ON s.id = (
                SELECT current_snapshot.id
                FROM game_archive_snapshots current_snapshot
                WHERE current_snapshot.game_id = g.id
                  AND current_snapshot.restored_at IS NULL
                ORDER BY current_snapshot.id DESC
                LIMIT 1
            )
            WHERE g.guild_id = ?
              AND g.id = ?
              AND g.lifecycle_status = 'archived'
        `).get(guildId, gameId) ?? null;
    }

    listArchivedGames(guildId) {
        if (!database.isInitialized) return [];
        return database.connection().prepare(`
            SELECT g.*, s.id AS archive_snapshot_id,
                   (
                       SELECT COUNT(*)
                       FROM game_restore_requests r
                       WHERE r.archive_snapshot_id = s.id
                   ) AS restore_request_count
            FROM games g
            LEFT JOIN game_archive_snapshots s ON s.id = (
                SELECT current_snapshot.id
                FROM game_archive_snapshots current_snapshot
                WHERE current_snapshot.game_id = g.id
                  AND current_snapshot.restored_at IS NULL
                ORDER BY current_snapshot.id DESC
                LIMIT 1
            )
            WHERE g.guild_id = ?
              AND g.lifecycle_status = 'archived'
            ORDER BY g.display_name
        `).all(guildId);
    }

    hasRestoreRequest(snapshotId, userId) {
        if (!database.isInitialized || !snapshotId) return false;
        return Boolean(database.connection().prepare(`
            SELECT 1 FROM game_restore_requests
            WHERE archive_snapshot_id = ? AND user_id = ?
        `).get(snapshotId, userId));
    }

    toggleRestoreRequest({ guildId, gameId, snapshotId, userId }) {
        return database.transaction(() => {
            const existing = database.connection().prepare(`
                SELECT 1 FROM game_restore_requests
                WHERE archive_snapshot_id = ? AND user_id = ?
            `).get(snapshotId, userId);
            const now = nowIso();
            let requested;

            if (existing) {
                database.connection().prepare(`
                    DELETE FROM game_restore_requests
                    WHERE archive_snapshot_id = ? AND user_id = ?
                `).run(snapshotId, userId);
                requested = false;
            } else {
                database.connection().prepare(`
                    INSERT INTO game_restore_requests (
                        archive_snapshot_id, game_id, guild_id, user_id, requested_at
                    ) VALUES (?, ?, ?, ?, ?)
                `).run(snapshotId, gameId, guildId, userId, now);
                database.connection().prepare(`
                    INSERT INTO user_game_preferences (
                        guild_id, user_id, game_id, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(guild_id, user_id, game_id) DO UPDATE SET
                        updated_at = excluded.updated_at
                `).run(guildId, userId, gameId, now, now);
                requested = true;
            }

            const count = database.connection().prepare(`
                SELECT COUNT(*) AS count
                FROM game_restore_requests
                WHERE archive_snapshot_id = ?
            `).get(snapshotId).count;
            return { requested, count };
        })();
    }

    summarizeRestoreRequests(guildId) {
        if (!database.isInitialized) return { games: 0, users: 0 };
        return database.connection().prepare(`
            SELECT COUNT(DISTINCT r.game_id) AS games,
                   COUNT(DISTINCT r.user_id) AS users
            FROM game_restore_requests r
            JOIN games g ON g.id = r.game_id
            JOIN game_archive_snapshots s ON s.id = r.archive_snapshot_id
            WHERE r.guild_id = ?
              AND g.lifecycle_status = 'archived'
              AND s.restored_at IS NULL
        `).get(guildId);
    }

    findAlert(snapshotId) {
        if (!database.isInitialized || !snapshotId) return null;
        return database.connection().prepare(`
            SELECT * FROM game_restore_alerts WHERE archive_snapshot_id = ?
        `).get(snapshotId) ?? null;
    }

    reserveAlert({ snapshotId, gameId, guildId, adminChannelId, count }) {
        const now = nowIso();
        const result = database.connection().prepare(`
            INSERT OR IGNORE INTO game_restore_alerts (
                archive_snapshot_id, game_id, guild_id, admin_channel_id,
                request_count, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'open', ?, ?)
        `).run(snapshotId, gameId, guildId, adminChannelId, count, now, now);
        return result.changes === 1;
    }

    setAlertMessage(snapshotId, messageId) {
        database.connection().prepare(`
            UPDATE game_restore_alerts
            SET message_id = ?, updated_at = ?
            WHERE archive_snapshot_id = ? AND status = 'open'
        `).run(messageId, nowIso(), snapshotId);
        return this.findAlert(snapshotId);
    }

    updateAlertCount(snapshotId, count) {
        database.connection().prepare(`
            UPDATE game_restore_alerts
            SET request_count = ?, updated_at = ?
            WHERE archive_snapshot_id = ?
        `).run(count, nowIso(), snapshotId);
        return this.findAlert(snapshotId);
    }

    releaseUnsentAlert(snapshotId) {
        database.connection().prepare(`
            DELETE FROM game_restore_alerts
            WHERE archive_snapshot_id = ? AND message_id IS NULL
        `).run(snapshotId);
    }

    dismissAlert(guildId, snapshotId) {
        const result = database.connection().prepare(`
            UPDATE game_restore_alerts
            SET status = 'dismissed', updated_at = ?
            WHERE guild_id = ? AND archive_snapshot_id = ? AND status = 'open'
        `).run(nowIso(), guildId, snapshotId);
        return result.changes ? this.findAlert(snapshotId) : null;
    }

    resolveAlert(snapshotId) {
        database.connection().prepare(`
            UPDATE game_restore_alerts
            SET status = 'resolved', updated_at = ?
            WHERE archive_snapshot_id = ? AND status != 'resolved'
        `).run(nowIso(), snapshotId);
        return this.findAlert(snapshotId);
    }
}

export default new GameInterestRepository();

import database from './database.js';

function nowIso() {
    return new Date().toISOString();
}

class ArchiveRepository {
    registerCategory(guildId, categoryId, sequence) {
        database.connection().prepare(`
            INSERT INTO archive_categories (guild_id, category_id, sequence, created_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(category_id) DO UPDATE SET sequence = excluded.sequence
        `).run(guildId, categoryId, sequence, nowIso());
    }

    listCategories(guildId) {
        if (!database.isInitialized) return [];
        return database.connection().prepare(`
            SELECT * FROM archive_categories WHERE guild_id = ? ORDER BY sequence
        `).all(guildId);
    }

    beginOperation({ gameId, type, userId, snapshot = null }) {
        return database.transaction(() => {
            const now = nowIso();
            let snapshotId = null;
            if (snapshot) {
                const snapshotResult = database.connection().prepare(`
                    INSERT INTO game_archive_snapshots (
                        game_id, channel_id, snapshot_version, snapshot_json,
                        archived_by, created_at
                    ) VALUES (?, ?, 1, ?, ?, ?)
                `).run(gameId, snapshot.channelId, JSON.stringify(snapshot.data), userId, now);
                snapshotId = Number(snapshotResult.lastInsertRowid);
            } else {
                snapshotId = this.latestSnapshot(gameId)?.id ?? null;
            }
            const result = database.connection().prepare(`
                INSERT INTO game_archive_operations (
                    game_id, snapshot_id, operation_type, status,
                    current_phase, initiated_by, created_at, updated_at
                ) VALUES (?, ?, ?, 'in_progress', 'started', ?, ?, ?)
            `).run(gameId, snapshotId, type, userId, now, now);
            return this.findOperation(Number(result.lastInsertRowid));
        })();
    }

    updateOperation(operationId, { status = null, phase = null, error = null }) {
        const current = this.findOperation(operationId);
        if (!current) return null;
        database.connection().prepare(`
            UPDATE game_archive_operations
            SET status = ?, current_phase = ?, error_message = ?, updated_at = ?
            WHERE id = ?
        `).run(
            status ?? current.status,
            phase ?? current.current_phase,
            error,
            nowIso(),
            operationId
        );
        return this.findOperation(operationId);
    }

    findOperation(operationId) {
        if (!database.isInitialized) return null;
        return database.connection().prepare(`
            SELECT * FROM game_archive_operations WHERE id = ?
        `).get(operationId) ?? null;
    }

    latestSnapshot(gameId) {
        if (!database.isInitialized) return null;
        return database.connection().prepare(`
            SELECT * FROM game_archive_snapshots
            WHERE game_id = ? ORDER BY id DESC LIMIT 1
        `).get(gameId) ?? null;
    }

    getSnapshot(snapshotId) {
        if (!database.isInitialized || !snapshotId) return null;
        const row = database.connection().prepare(`
            SELECT * FROM game_archive_snapshots WHERE id = ?
        `).get(snapshotId);
        if (!row) return null;
        return { ...row, data: JSON.parse(row.snapshot_json) };
    }

    markSnapshotRestored(snapshotId) {
        database.connection().prepare(`
            UPDATE game_archive_snapshots SET restored_at = ? WHERE id = ?
        `).run(nowIso(), snapshotId);
    }

    markInterruptedOperations() {
        if (!database.isInitialized) return 0;
        return database.connection().prepare(`
            UPDATE game_archive_operations
            SET status = 'manual_attention',
                error_message = COALESCE(error_message, 'Bot再起動により操作が中断されました'),
                updated_at = ?
            WHERE status = 'in_progress'
        `).run(nowIso()).changes;
    }

    hasBlockingOperation(gameId) {
        if (!database.isInitialized) return false;
        return Boolean(database.connection().prepare(`
            SELECT 1 FROM game_archive_operations
            WHERE game_id = ? AND status IN ('in_progress', 'manual_attention')
            LIMIT 1
        `).get(gameId));
    }

    listAttention(guildId) {
        if (!database.isInitialized) return [];
        return database.connection().prepare(`
            SELECT op.*, g.display_name, g.guild_id, g.current_channel_id
            FROM game_archive_operations op
            JOIN games g ON g.id = op.game_id
            WHERE g.guild_id = ? AND op.status = 'manual_attention'
            ORDER BY op.updated_at DESC
        `).all(guildId);
    }
}

export default new ArchiveRepository();

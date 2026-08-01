CREATE TABLE IF NOT EXISTS archive_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    category_id TEXT NOT NULL UNIQUE,
    sequence INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (guild_id, sequence)
);

CREATE TABLE IF NOT EXISTS game_archive_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL,
    snapshot_version INTEGER NOT NULL DEFAULT 1,
    snapshot_json TEXT NOT NULL,
    archived_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    restored_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_archive_snapshots_game
    ON game_archive_snapshots (game_id, created_at DESC);

CREATE TABLE IF NOT EXISTS game_archive_operations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    snapshot_id INTEGER REFERENCES game_archive_snapshots(id) ON DELETE SET NULL,
    operation_type TEXT NOT NULL CHECK (operation_type IN ('archive', 'restore')),
    status TEXT NOT NULL
        CHECK (status IN ('in_progress', 'succeeded', 'rolled_back', 'manual_attention', 'failed')),
    current_phase TEXT NOT NULL,
    error_message TEXT,
    initiated_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_archive_operations_one_running
    ON game_archive_operations (game_id)
    WHERE status = 'in_progress';
CREATE INDEX IF NOT EXISTS idx_archive_operations_attention
    ON game_archive_operations (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS game_archive_deferrals (
    game_id INTEGER PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
    deferred_until TEXT NOT NULL,
    deferred_by TEXT NOT NULL,
    reason TEXT,
    updated_at TEXT NOT NULL
);


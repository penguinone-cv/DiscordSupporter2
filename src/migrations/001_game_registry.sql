CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id TEXT PRIMARY KEY,
    game_category_id TEXT,
    admin_channel_id TEXT,
    admin_panel_message_id TEXT,
    dormant_after_days INTEGER NOT NULL DEFAULT 90 CHECK (dormant_after_days > 0),
    archive_visibility TEXT NOT NULL DEFAULT 'read_only'
        CHECK (archive_visibility IN ('read_only', 'hidden')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    lifecycle_status TEXT NOT NULL DEFAULT 'active'
        CHECK (lifecycle_status IN ('active', 'archived')),
    current_channel_id TEXT,
    current_role_id TEXT,
    archive_excluded INTEGER NOT NULL DEFAULT 0 CHECK (archive_excluded IN (0, 1)),
    archived_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_games_guild_status
    ON games (guild_id, lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_games_guild_normalized_name
    ON games (guild_id, normalized_name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_games_current_channel_unique
    ON games (current_channel_id)
    WHERE current_channel_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS game_channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL UNIQUE,
    channel_name TEXT NOT NULL,
    parent_category_id TEXT,
    active_from TEXT NOT NULL,
    active_until TEXT,
    detach_reason TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_game_channels_current_game
    ON game_channels (game_id)
    WHERE active_until IS NULL;

CREATE TABLE IF NOT EXISTS game_channel_activity (
    game_channel_id INTEGER PRIMARY KEY REFERENCES game_channels(id) ON DELETE CASCADE,
    last_user_message_at TEXT,
    last_user_id TEXT,
    last_any_message_at TEXT,
    last_reconciled_at TEXT,
    reconciliation_status TEXT NOT NULL DEFAULT 'unknown'
        CHECK (reconciliation_status IN ('unknown', 'confirmed')),
    updated_at TEXT NOT NULL
);


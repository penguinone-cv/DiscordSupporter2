ALTER TABLE guild_settings ADD COLUMN member_panel_channel_id TEXT;
ALTER TABLE guild_settings ADD COLUMN member_panel_message_id TEXT;
ALTER TABLE guild_settings ADD COLUMN restore_request_threshold INTEGER NOT NULL DEFAULT 5
    CHECK (restore_request_threshold BETWEEN 1 AND 100);

CREATE TABLE IF NOT EXISTS user_game_preferences (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (guild_id, user_id, game_id)
);

CREATE INDEX IF NOT EXISTS idx_user_game_preferences_game
    ON user_game_preferences (game_id, guild_id);

CREATE TABLE IF NOT EXISTS game_restore_requests (
    archive_snapshot_id INTEGER NOT NULL
        REFERENCES game_archive_snapshots(id) ON DELETE CASCADE,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    requested_at TEXT NOT NULL,
    PRIMARY KEY (archive_snapshot_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_game_restore_requests_game
    ON game_restore_requests (guild_id, game_id, archive_snapshot_id);

CREATE TABLE IF NOT EXISTS game_restore_alerts (
    archive_snapshot_id INTEGER PRIMARY KEY
        REFERENCES game_archive_snapshots(id) ON DELETE CASCADE,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    guild_id TEXT NOT NULL,
    admin_channel_id TEXT NOT NULL,
    message_id TEXT,
    request_count INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'dismissed', 'resolved')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_game_restore_alerts_guild_status
    ON game_restore_alerts (guild_id, status, updated_at DESC);

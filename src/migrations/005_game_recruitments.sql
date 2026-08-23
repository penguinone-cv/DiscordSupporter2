CREATE TABLE IF NOT EXISTS game_recruitments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    slot_id INTEGER NOT NULL REFERENCES availability_slots(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL,
    role_id TEXT NOT NULL,
    creator_user_id TEXT NOT NULL,
    message_id TEXT,
    confirmation_emoji_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'open', 'confirmed')),
    confirmed_by_user_id TEXT,
    confirmed_at TEXT,
    reminder_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (game_id, slot_id),
    CHECK (
        (status = 'pending' AND message_id IS NULL AND confirmation_emoji_id IS NULL)
        OR
        (status IN ('open', 'confirmed')
            AND message_id IS NOT NULL
            AND confirmation_emoji_id IS NOT NULL)
    ),
    CHECK (
        (status = 'confirmed'
            AND confirmed_by_user_id IS NOT NULL
            AND confirmed_at IS NOT NULL)
        OR
        (status != 'confirmed'
            AND confirmed_by_user_id IS NULL
            AND confirmed_at IS NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_game_recruitments_message_unique
    ON game_recruitments (message_id)
    WHERE message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_game_recruitments_guild_status
    ON game_recruitments (guild_id, status, updated_at DESC);

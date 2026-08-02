ALTER TABLE guild_settings
    ADD COLUMN schedule_timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo';

CREATE TABLE IF NOT EXISTS availability_slot_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    slot_key TEXT NOT NULL,
    label TEXT NOT NULL,
    start_minutes INTEGER NOT NULL CHECK (start_minutes BETWEEN 0 AND 1439),
    end_minutes INTEGER CHECK (end_minutes IS NULL OR end_minutes BETWEEN 0 AND 1439),
    day_kind TEXT NOT NULL CHECK (day_kind IN ('weekday', 'rest_day')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (guild_id, slot_key)
);

CREATE INDEX IF NOT EXISTS idx_availability_templates_guild
    ON availability_slot_templates (guild_id, enabled, day_kind, sort_order);

CREATE TABLE IF NOT EXISTS availability_months (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    year INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2200),
    month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo',
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (guild_id, year, month)
);

CREATE INDEX IF NOT EXISTS idx_availability_months_guild
    ON availability_months (guild_id, year, month);

CREATE TABLE IF NOT EXISTS availability_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    month_id INTEGER NOT NULL REFERENCES availability_months(id) ON DELETE CASCADE,
    template_id INTEGER NOT NULL
        REFERENCES availability_slot_templates(id) ON DELETE RESTRICT,
    local_date TEXT NOT NULL,
    day_rule TEXT NOT NULL
        CHECK (day_rule IN ('0', '1', '2', '3', '4', '5', '6', 'holiday')),
    label TEXT NOT NULL,
    start_minutes INTEGER NOT NULL CHECK (start_minutes BETWEEN 0 AND 1439),
    end_minutes INTEGER CHECK (end_minutes IS NULL OR end_minutes BETWEEN 0 AND 1439),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE (month_id, local_date, template_id)
);

CREATE INDEX IF NOT EXISTS idx_availability_slots_month_date
    ON availability_slots (month_id, local_date, sort_order);

CREATE TABLE IF NOT EXISTS user_availability_patterns (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    day_rule TEXT NOT NULL
        CHECK (day_rule IN ('0', '1', '2', '3', '4', '5', '6', 'holiday')),
    template_id INTEGER NOT NULL
        REFERENCES availability_slot_templates(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('available', 'maybe', 'unavailable')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (guild_id, user_id, day_rule, template_id)
);

CREATE INDEX IF NOT EXISTS idx_availability_patterns_guild_user
    ON user_availability_patterns (guild_id, user_id, day_rule);

CREATE TABLE IF NOT EXISTS user_availability (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    slot_id INTEGER NOT NULL REFERENCES availability_slots(id) ON DELETE CASCADE,
    status TEXT NOT NULL
        CHECK (status IN ('available', 'maybe', 'unavailable', 'unset')),
    source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('basic', 'manual')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (slot_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_availability_guild_user
    ON user_availability (guild_id, user_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_user_availability_slot_status
    ON user_availability (slot_id, status, user_id);

import database from './database.js';

function nowIso() {
    return new Date().toISOString();
}

const DEFAULT_TEMPLATES = [
    {
        slotKey: 'weekday-night',
        label: '夜',
        startMinutes: 21 * 60,
        endMinutes: null,
        dayKind: 'weekday',
        sortOrder: 10
    },
    {
        slotKey: 'rest-day-afternoon',
        label: '昼',
        startMinutes: 14 * 60,
        endMinutes: null,
        dayKind: 'rest_day',
        sortOrder: 10
    },
    {
        slotKey: 'rest-day-night',
        label: '夜',
        startMinutes: 21 * 60,
        endMinutes: null,
        dayKind: 'rest_day',
        sortOrder: 20
    }
];

class AvailabilityRepository {
    ensureDefaultTemplates(guildId) {
        const insert = database.connection().prepare(`
            INSERT OR IGNORE INTO availability_slot_templates (
                guild_id, slot_key, label, start_minutes, end_minutes,
                day_kind, sort_order, enabled, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        `);
        const now = nowIso();
        database.transaction(() => {
            for (const template of DEFAULT_TEMPLATES) {
                insert.run(
                    guildId,
                    template.slotKey,
                    template.label,
                    template.startMinutes,
                    template.endMinutes,
                    template.dayKind,
                    template.sortOrder,
                    now,
                    now
                );
            }
        })();
        return this.listTemplates(guildId);
    }

    listTemplates(guildId) {
        if (!database.isInitialized) return [];
        return database.connection().prepare(`
            SELECT * FROM availability_slot_templates
            WHERE guild_id = ? AND enabled = 1
            ORDER BY day_kind, sort_order, id
        `).all(guildId);
    }

    findTemplate(guildId, templateId) {
        if (!database.isInitialized) return null;
        return database.connection().prepare(`
            SELECT * FROM availability_slot_templates
            WHERE guild_id = ? AND id = ? AND enabled = 1
        `).get(guildId, templateId) ?? null;
    }

    ensureMonth(guildId, year, month, timezone = 'Asia/Tokyo') {
        const now = nowIso();
        database.connection().prepare(`
            INSERT INTO availability_months (
                guild_id, year, month, timezone, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 'open', ?, ?)
            ON CONFLICT(guild_id, year, month) DO UPDATE SET
                updated_at = excluded.updated_at
        `).run(guildId, year, month, timezone, now, now);
        return this.findMonth(guildId, year, month);
    }

    findMonth(guildId, year, month) {
        if (!database.isInitialized) return null;
        return database.connection().prepare(`
            SELECT * FROM availability_months
            WHERE guild_id = ? AND year = ? AND month = ?
        `).get(guildId, year, month) ?? null;
    }

    findMonthById(guildId, monthId) {
        if (!database.isInitialized) return null;
        return database.connection().prepare(`
            SELECT * FROM availability_months WHERE guild_id = ? AND id = ?
        `).get(guildId, monthId) ?? null;
    }

    insertSlots(monthId, slots) {
        const insert = database.connection().prepare(`
            INSERT OR IGNORE INTO availability_slots (
                month_id, template_id, local_date, day_rule, label,
                start_minutes, end_minutes, sort_order, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const now = nowIso();
        return database.transaction(() => {
            let inserted = 0;
            for (const slot of slots) {
                inserted += insert.run(
                    monthId,
                    slot.templateId,
                    slot.localDate,
                    slot.dayRule,
                    slot.label,
                    slot.startMinutes,
                    slot.endMinutes,
                    slot.sortOrder,
                    now
                ).changes;
            }
            return inserted;
        })();
    }

    listMonthSlots(guildId, monthId) {
        if (!database.isInitialized) return [];
        return database.connection().prepare(`
            SELECT slot.*
            FROM availability_slots slot
            JOIN availability_months month ON month.id = slot.month_id
            WHERE month.guild_id = ? AND month.id = ?
            ORDER BY slot.local_date, slot.sort_order, slot.id
        `).all(guildId, monthId);
    }

    listBasicPatterns(guildId, userId, dayRule = null) {
        if (!database.isInitialized) return [];
        if (dayRule !== null) {
            return database.connection().prepare(`
                SELECT pattern.*, template.label, template.start_minutes,
                       template.end_minutes, template.day_kind, template.sort_order
                FROM user_availability_patterns pattern
                JOIN availability_slot_templates template ON template.id = pattern.template_id
                WHERE pattern.guild_id = ? AND pattern.user_id = ? AND pattern.day_rule = ?
                ORDER BY template.sort_order, template.id
            `).all(guildId, userId, dayRule);
        }
        return database.connection().prepare(`
            SELECT pattern.*, template.label, template.start_minutes,
                   template.end_minutes, template.day_kind, template.sort_order
            FROM user_availability_patterns pattern
            JOIN availability_slot_templates template ON template.id = pattern.template_id
            WHERE pattern.guild_id = ? AND pattern.user_id = ?
            ORDER BY pattern.day_rule, template.sort_order, template.id
        `).all(guildId, userId);
    }

    setBasicStatus({ guildId, userId, dayRule, templateId, status }) {
        if (status === null) {
            database.connection().prepare(`
                DELETE FROM user_availability_patterns
                WHERE guild_id = ? AND user_id = ? AND day_rule = ? AND template_id = ?
            `).run(guildId, userId, dayRule, templateId);
            return null;
        }
        const now = nowIso();
        database.connection().prepare(`
            INSERT INTO user_availability_patterns (
                guild_id, user_id, day_rule, template_id,
                status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(guild_id, user_id, day_rule, template_id) DO UPDATE SET
                status = excluded.status,
                updated_at = excluded.updated_at
        `).run(guildId, userId, dayRule, templateId, status, now, now);
        return status;
    }

    materializeBasicForAllUsers(guildId, monthId) {
        const now = nowIso();
        return database.connection().prepare(`
            INSERT INTO user_availability (
                guild_id, user_id, slot_id, status, source, created_at, updated_at
            )
            SELECT pattern.guild_id, pattern.user_id, slot.id,
                   pattern.status, 'basic', ?, ?
            FROM availability_slots slot
            JOIN availability_months month ON month.id = slot.month_id
            JOIN user_availability_patterns pattern
              ON pattern.guild_id = month.guild_id
             AND pattern.day_rule = slot.day_rule
             AND pattern.template_id = slot.template_id
            WHERE month.guild_id = ? AND month.id = ?
            ON CONFLICT(slot_id, user_id) DO NOTHING
        `).run(now, now, guildId, monthId).changes;
    }

    materializeBasicForUser(guildId, userId, monthId) {
        const now = nowIso();
        return database.connection().prepare(`
            INSERT INTO user_availability (
                guild_id, user_id, slot_id, status, source, created_at, updated_at
            )
            SELECT pattern.guild_id, pattern.user_id, slot.id,
                   pattern.status, 'basic', ?, ?
            FROM availability_slots slot
            JOIN availability_months month ON month.id = slot.month_id
            JOIN user_availability_patterns pattern
              ON pattern.guild_id = month.guild_id
             AND pattern.user_id = ?
             AND pattern.day_rule = slot.day_rule
             AND pattern.template_id = slot.template_id
            WHERE month.guild_id = ? AND month.id = ?
            ON CONFLICT(slot_id, user_id) DO NOTHING
        `).run(now, now, userId, guildId, monthId).changes;
    }

    listUserMonthSlots(guildId, userId, monthId) {
        if (!database.isInitialized) return [];
        return database.connection().prepare(`
            SELECT slot.*,
                   COALESCE(answer.status, 'unset') AS status,
                   answer.source
            FROM availability_slots slot
            JOIN availability_months month ON month.id = slot.month_id
            LEFT JOIN user_availability answer
              ON answer.slot_id = slot.id AND answer.user_id = ?
            WHERE month.guild_id = ? AND month.id = ?
            ORDER BY slot.local_date, slot.sort_order, slot.id
        `).all(userId, guildId, monthId);
    }

    findUserSlot(guildId, userId, slotId) {
        if (!database.isInitialized) return null;
        return database.connection().prepare(`
            SELECT slot.*, month.guild_id,
                   COALESCE(answer.status, 'unset') AS status,
                   answer.source
            FROM availability_slots slot
            JOIN availability_months month ON month.id = slot.month_id
            LEFT JOIN user_availability answer
              ON answer.slot_id = slot.id AND answer.user_id = ?
            WHERE month.guild_id = ? AND slot.id = ?
        `).get(userId, guildId, slotId) ?? null;
    }

    setUserSlotStatus({ guildId, userId, slotId, status, source = 'manual' }) {
        const slot = this.findUserSlot(guildId, userId, slotId);
        if (!slot) throw new Error('対象の日時枠が見つかりません');
        const now = nowIso();
        database.connection().prepare(`
            INSERT INTO user_availability (
                guild_id, user_id, slot_id, status, source, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(slot_id, user_id) DO UPDATE SET
                status = excluded.status,
                source = excluded.source,
                updated_at = excluded.updated_at
        `).run(guildId, userId, slotId, status, source, now, now);
        return this.findUserSlot(guildId, userId, slotId);
    }

    resetDateRangeToBasic({ guildId, userId, monthId, startDate, endDate }) {
        return database.transaction(() => {
            database.connection().prepare(`
                DELETE FROM user_availability
                WHERE guild_id = ? AND user_id = ?
                  AND slot_id IN (
                      SELECT id FROM availability_slots
                      WHERE month_id = ? AND local_date BETWEEN ? AND ?
                  )
            `).run(guildId, userId, monthId, startDate, endDate);
            const now = nowIso();
            return database.connection().prepare(`
                INSERT INTO user_availability (
                    guild_id, user_id, slot_id, status, source, created_at, updated_at
                )
                SELECT pattern.guild_id, pattern.user_id, slot.id,
                       pattern.status, 'basic', ?, ?
                FROM availability_slots slot
                JOIN availability_months month ON month.id = slot.month_id
                JOIN user_availability_patterns pattern
                  ON pattern.guild_id = month.guild_id
                 AND pattern.user_id = ?
                 AND pattern.day_rule = slot.day_rule
                 AND pattern.template_id = slot.template_id
                WHERE month.guild_id = ? AND month.id = ?
                  AND slot.local_date BETWEEN ? AND ?
                ON CONFLICT(slot_id, user_id) DO UPDATE SET
                    status = excluded.status,
                    source = 'basic',
                    updated_at = excluded.updated_at
            `).run(now, now, userId, guildId, monthId, startDate, endDate).changes;
        })();
    }

    listCandidateResponses(guildId, monthId, gameId) {
        if (!database.isInitialized) return [];
        return database.connection().prepare(`
            SELECT slot.id AS slot_id, slot.local_date, slot.label,
                   slot.start_minutes, slot.end_minutes, slot.sort_order,
                   answer.user_id, answer.status
            FROM user_availability answer
            JOIN availability_slots slot ON slot.id = answer.slot_id
            JOIN availability_months month ON month.id = slot.month_id
            JOIN user_game_preferences preference
              ON preference.guild_id = answer.guild_id
             AND preference.user_id = answer.user_id
             AND preference.game_id = ?
            JOIN games game ON game.id = preference.game_id
            WHERE answer.guild_id = ?
              AND month.id = ?
              AND answer.status IN ('available', 'maybe')
              AND game.guild_id = ?
              AND game.lifecycle_status = 'active'
              AND game.current_channel_id IS NOT NULL
            ORDER BY slot.local_date, slot.sort_order, slot.id, answer.user_id
        `).all(gameId, guildId, monthId, guildId);
    }
}

export { DEFAULT_TEMPLATES };
export default new AvailabilityRepository();

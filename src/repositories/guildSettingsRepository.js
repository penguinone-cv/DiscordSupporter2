import database from './database.js';

class GuildSettingsRepository {
    find(guildId) {
        if (!database.isInitialized) return null;
        return database.connection()
            .prepare('SELECT * FROM guild_settings WHERE guild_id = ?')
            .get(guildId) ?? null;
    }

    upsert({
        guildId,
        gameCategoryId = null,
        adminChannelId = null,
        dormantAfterDays = 90,
        archiveVisibility = 'read_only'
    }) {
        const now = new Date().toISOString();
        database.connection().prepare(`
            INSERT INTO guild_settings (
                guild_id, game_category_id, admin_channel_id,
                dormant_after_days, archive_visibility, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(guild_id) DO UPDATE SET
                game_category_id = COALESCE(excluded.game_category_id, guild_settings.game_category_id),
                admin_channel_id = COALESCE(excluded.admin_channel_id, guild_settings.admin_channel_id),
                dormant_after_days = excluded.dormant_after_days,
                archive_visibility = excluded.archive_visibility,
                updated_at = excluded.updated_at
        `).run(
            guildId,
            gameCategoryId,
            adminChannelId,
            dormantAfterDays,
            archiveVisibility,
            now,
            now
        );
        return this.find(guildId);
    }

    setPanelMessage(guildId, messageId) {
        database.connection().prepare(`
            UPDATE guild_settings
            SET admin_panel_message_id = ?, updated_at = ?
            WHERE guild_id = ?
        `).run(messageId, new Date().toISOString(), guildId);
    }

    listConfigured() {
        if (!database.isInitialized) return [];
        return database.connection().prepare(`
            SELECT * FROM guild_settings
            WHERE game_category_id IS NOT NULL
        `).all();
    }
}

export default new GuildSettingsRepository();


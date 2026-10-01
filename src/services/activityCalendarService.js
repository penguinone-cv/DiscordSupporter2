import { ChannelType, PermissionFlagsBits } from 'discord.js';
import reminderService from './reminderService.js';
import scheduleService from './scheduleService.js';
import gameRepository from '../repositories/gameRepository.js';
import database from '../repositories/database.js';
import { currentDateKey, currentYearMonth } from '../utils/scheduleDate.js';

function fail(status, code, message) {
    throw Object.assign(new Error(message), { status, code });
}

export class ActivityCalendarService {
    constructor({ reminders = reminderService, schedules = scheduleService } = {}) {
        this.reminders = reminders;
        this.schedules = schedules;
    }

    getCalendar(guild, member, { year, month, channelId } = {}, now = new Date()) {
        const timezone = this.schedules.timezoneForGuild(guild.id);
        if (year === undefined && month === undefined) ({ year, month } = currentYearMonth(now, timezone));
        if (!Number.isInteger(year) || year < 1000 || year > 9999
            || !Number.isInteger(month) || month < 1 || month > 12) {
            fail(400, 'invalid_month', '表示する年月を確認してください');
        }
        // Resolve only through this guild's live channel cache. Legacy JSON names do not grant access.
        const visible = [...guild.channels.cache.values()].filter(channel => {
            if (channel.guildId !== guild.id || !channel.isTextBased()) return false;
            const permissions = channel.permissionsFor(member);
            if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])) return false;
            return channel.type !== ChannelType.PrivateThread
                || permissions.has(PermissionFlagsBits.ManageThreads) || channel.members.cache.has(member.id);
        });
        const channelsById = new Map(visible.map(channel => [channel.id, channel]));
        if (channelId && !channelsById.has(channelId)) {
            fail(404, 'channel_not_found', '対象のチャンネルを閲覧できません。チャンネルを選び直してください。');
        }
        const activity = this.reminders.getChannelActivity();
        const channels = visible.map(channel => ({ id: channel.id, name: channel.name }))
            .sort((a, b) => (activity[b.id]?.lastActivityAt ?? '').localeCompare(activity[a.id]?.lastActivityAt ?? '')
                || a.name.localeCompare(b.name, 'ja') || a.id.localeCompare(b.id));
        const prefix = `${year}-${String(month).padStart(2, '0')}-`;
        const events = this.reminders.getCalendarEvents().flatMap(event => {
            if (event.guildId !== guild.id || !channelsById.has(event.channelId)) return [];
            const date = new Date(event.remindAt);
            if (!Number.isFinite(date.getTime())) return [];
            const localDate = currentDateKey(date, timezone);
            if (!localDate.startsWith(prefix)) return [];
            return [{
                id: event.id, channelId: event.channelId, channelName: channelsById.get(event.channelId).name,
                localDate, content: event.originalContent
            }];
        }).sort((a, b) => a.localDate.localeCompare(b.localDate) || a.channelName.localeCompare(b.channelName, 'ja') || a.id.localeCompare(b.id));

        const relatedEvents = [];
        if (channelId) {
            const selected = channelsById.get(channelId);
            const roleFor = channel => {
                const game = database.isInitialized ? gameRepository.findByChannelId(channel.id) : null;
                return game ? guild.roles.cache.get(game.current_role_id)
                    : guild.roles.cache.find(role => role.name === channel.name);
            };
            const selectedRole = roleFor(selected);
            if (selectedRole) {
                const members = [...selectedRole.members.values()].filter(item => !item.user.bot);
                const roles = new Map(visible.map(channel => [channel.id, roleFor(channel)]));
                for (const event of events) {
                    const role = roles.get(event.channelId);
                    if (event.channelId === channelId || !role) continue;
                    const names = members.filter(item => item.roles.cache.has(role.id)).map(item => item.displayName);
                    if (names.length) relatedEvents.push({ ...event, memberNames: names });
                }
            }
        }
        return {
            month: { year, month, timezone }, today: currentDateKey(now, timezone), channels,
            events: channelId ? events.filter(event => event.channelId === channelId) : events,
            relatedEvents
        };
    }
}

export default new ActivityCalendarService();

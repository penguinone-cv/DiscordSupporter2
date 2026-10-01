import { ChannelType, Collection, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import database from '../../src/repositories/database.js';
import gameRepository from '../../src/repositories/gameRepository.js';
import { ActivityCalendarService } from '../../src/services/activityCalendarService.js';

const READ = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory];

describe('Activityの確定済み予定', () => {
    let guild, self, events, reminders, service;
    beforeEach(() => {
        database.close(); database.initialize(':memory:');
        self = { id: 'self', user: { bot: false }, roles: { cache: new Collection() } };
        guild = { id: 'guild', channels: { cache: new Collection() }, roles: { cache: new Collection() } };
        events = [];
        reminders = { getCalendarEvents: () => events, getChannelActivity: () => ({}), getReminders: vi.fn(() => { throw new Error('通知済み予定を失う取得元'); }) };
        service = new ActivityCalendarService({ reminders });
    });
    afterEach(() => database.close());
    function channel(id, name = id, permissions = READ, extra = {}) {
        const value = { id, name, guildId: guild.id, type: ChannelType.GuildText,
            isTextBased: () => true, permissionsFor: () => new PermissionsBitField(permissions), ...extra };
        guild.channels.cache.set(id, value);
        return value;
    }
    function event(id, channelId, remindAt = '2026-09-05T03:00:00Z', guildId = guild.id) {
        events.push({ id, guildId, channelId, originalContent: `予定 ${id}`, remindAt });
    }

    it('通知後も保持された予定をサーバーの月で分類し、他guild・権限なし・削除済み・壊れた日時を返さない', () => {
        channel('visible', '変更後のチャンネル名'); channel('hidden', 'secret', []);
        channel('no-history', 'history-secret', [PermissionFlagsBits.ViewChannel]);
        channel('foreign', 'foreign', READ, { guildId: 'other-guild' });
        event('boundary', 'visible', '2026-08-31T15:00:00Z');
        event('previous', 'visible', '2026-08-31T14:59:59Z');
        event('next', 'visible', '2026-09-30T15:00:00Z');
        for (const id of ['hidden', 'no-history', 'deleted', 'foreign']) event(id, id);
        event('other-guild', 'visible', '2026-09-05T03:00:00Z', 'other-guild');
        event('invalid', 'visible', 'bad-date');
        const result = service.getCalendar(guild, self, {}, new Date('2026-08-31T15:00:00Z'));
        expect(result).toMatchObject({ month: { year: 2026, month: 9, timezone: 'Asia/Tokyo' }, today: '2026-09-01' });
        expect(result.events).toEqual([{ id: 'boundary', channelId: 'visible', channelName: '変更後のチャンネル名', localDate: '2026-09-01', content: '予定 boundary' }]);
        expect(result.channels).toEqual([{ id: 'visible', name: '変更後のチャンネル名' }]);
        expect(reminders.getReminders).not.toHaveBeenCalled();
    });

    it('同名チャンネルもIDで絞り込み、保存済みゲームロールと同名ロールの非Botメンバーに関連する可視予定を返す', () => {
        channel('selected', 'same-name'); channel('duplicate', 'same-name'); channel('related', 'other-game'); channel('secret', 'secret-game', []);
        const member = { id: 'u', displayName: 'ペンギン', user: { bot: false }, roles: { cache: new Collection([['stored-role', {}], ['other-role', {}], ['secret-role', {}]]) } };
        const bot = { ...member, id: 'bot', user: { bot: true } };
        const stranger = { ...member, id: 'stranger', roles: { cache: new Collection() } };
        guild.roles.cache.set('stored-role', { id: 'stored-role', name: 'renamed-role', members: new Collection([['u', member], ['bot', bot], ['stranger', stranger]]) });
        guild.roles.cache.set('other-role', { id: 'other-role', name: 'other-game', members: new Collection([['u', member], ['bot', bot]]) });
        guild.roles.cache.set('secret-role', { id: 'secret-role', name: 'secret-game', members: new Collection([['u', member]]) });
        gameRepository.registerChannel({ guildId: guild.id, channelId: 'selected', channelName: 'same-name', parentCategoryId: 'category', roleId: 'stored-role' });
        for (const id of ['selected', 'duplicate', 'related', 'secret']) event(id, id);
        const result = service.getCalendar(guild, self, { year: 2026, month: 9, channelId: 'selected' });
        expect(result.events.map(item => item.id)).toEqual(['selected']);
        expect(result.relatedEvents).toEqual([expect.objectContaining({ id: 'related', memberNames: ['ペンギン'] })]);
        for (const channelId of ['secret', 'missing']) {
            expect(() => service.getCalendar(guild, self, { year: 2026, month: 9, channelId })).toThrow(expect.objectContaining({ status: 404 }));
        }
    });

    it('私有スレッドは参加者か管理権限がある本人だけに表示する', () => {
        const members = new Collection();
        const thread = channel('private-thread', 'thread', READ, { type: ChannelType.PrivateThread, members: { cache: members } });
        event('private', thread.id);
        const read = () => service.getCalendar(guild, self, { year: 2026, month: 9 });
        expect(read().events).toEqual([]);
        members.set(self.id, {});
        expect(read().events.map(item => item.id)).toEqual(['private']);
        members.clear(); thread.permissionsFor = () => new PermissionsBitField([...READ, PermissionFlagsBits.ManageThreads]);
        expect(read().events.map(item => item.id)).toEqual(['private']);
    });

    it('過去月・年越しと別タイムゾーンを扱い、不正な年月を拒否する', () => {
        channel('c'); event('year-end', 'c', '2026-01-01T01:00:00Z');
        service = new ActivityCalendarService({ reminders, schedules: { timezoneForGuild: () => 'America/Los_Angeles' } });
        expect(service.getCalendar(guild, self, { year: 2025, month: 12 }).events[0].localDate).toBe('2025-12-31');
        expect(service.getCalendar(guild, self, { year: 2026, month: 1 }).events).toEqual([]);
        for (const input of [{ year: 2026 }, { month: 9 }, { year: 0, month: 1 }, { year: 10000, month: 1 }, { year: 2026, month: 0 }, { year: 2026, month: 13 }]) {
            expect(() => service.getCalendar(guild, self, input)).toThrow(expect.objectContaining({ status: 400 }));
        }
    });
});

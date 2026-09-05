import { Collection } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import database from '../../src/repositories/database.js';
import availabilityRepository from '../../src/repositories/availabilityRepository.js';
import scheduleService from '../../src/services/scheduleService.js';
import activityScheduleService from '../../src/services/activityScheduleService.js';

const NOW = new Date('2026-09-05T00:00:00Z');
const GUILD_ID = 'guild-1';

function guildFor(users = [['self', 'しろくま'], ['a', 'あざらし'], ['z', 'ペンギン']]) {
    const cache = new Collection(users.map(([id, displayName, bot = false]) => [
        id, { id, displayName, user: { id, bot, username: id } }
    ]));
    return { id: GUILD_ID, memberCount: cache.size, members: { cache, fetch: vi.fn() } };
}

function createMonth(year = 2026, month = 9, guildId = GUILD_ID) {
    return scheduleService.ensureMonth(guildId, year, month);
}

function slotOn(month, date = '2026-09-07') {
    return availabilityRepository.listMonthSlots(GUILD_ID, month.id)
        .find(slot => slot.local_date === date);
}

function setAnswer(month, userId, status, date = '2026-09-07') {
    availabilityRepository.setUserSlotStatus({
        guildId: GUILD_ID, userId, slotId: slotOn(month, date).id, status
    });
}

function setMondayBasic(userId, status) {
    const template = availabilityRepository.ensureDefaultTemplates(GUILD_ID)
        .find(item => item.slot_key === 'weekday-night');
    availabilityRepository.setBasicStatus({
        guildId: GUILD_ID, userId, templateId: template.id, dayRule: '1', status
    });
}

describe('activityScheduleService', () => {
    beforeEach(() => {
        database.close();
        database.initialize(':memory:');
    });

    afterEach(() => {
        vi.restoreAllMocks();
        database.close();
    });

    it('全非Botメンバーを集計し退会者を除外、未入力と未登録を合算する', async () => {
        const month = createMonth();
        setAnswer(month, 'self', 'available');
        setAnswer(month, 'a', 'maybe');
        setAnswer(month, 'z', 'unavailable');
        setAnswer(month, 'explicit', 'unset');
        setAnswer(month, 'departed', 'available');
        setAnswer(month, 'bot', 'available');
        const guild = guildFor([
            ['self', '自分'], ['a', 'あ'], ['z', 'い'], ['explicit', 'う'],
            ['new', 'え'], ['bot', 'Bot', true]
        ]);
        const view = await activityScheduleService.getMonth(guild, 'self', 0, NOW);
        expect(view).toMatchObject({
            month: { id: month.id, year: 2026, month: 9, timezone: 'Asia/Tokyo' },
            today: '2026-09-05', memberCount: 5, selfUserId: 'self'
        });
        const mondaySlot = view.slots.find(slot => slot.id === slotOn(month).id);
        expect(mondaySlot).toMatchObject({
            localDate: '2026-09-07', label: '夜', dayRule: '1',
            counts: { available: 1, maybe: 1, unavailable: 1, unset: 2 }, selfStatus: 'available'
        });
        expect(mondaySlot).not.toHaveProperty('startMinutes');
        for (const slot of view.slots) {
            expect(Object.values(slot.counts).reduce((sum, value) => sum + value, 0)).toBe(5);
        }
    });

    it('月単位で未登録を判定し、本人先頭と名前順で詳細を返す', async () => {
        setMondayBasic('a', 'available');
        const month = createMonth();
        setAnswer(month, 'self', 'unset');
        const guild = guildFor();
        const day = await activityScheduleService.getDay(guild, 'self', month.id, '2026-09-08', NOW);
        expect(day.localDate).toBe('2026-09-08');
        expect(day.slots[0].members).toEqual([
            { userId: 'self', displayName: 'しろくま', status: 'unset', isSelf: true },
            { userId: 'a', displayName: 'あざらし', status: 'unset', isSelf: false },
            { userId: 'z', displayName: 'ペンギン', status: 'unregistered', isSelf: false }
        ]);
        expect(day.slots[0]).not.toHaveProperty('startMinutes');
        const monday = await activityScheduleService.getDay(guild, 'self', month.id, '2026-09-07', NOW);
        expect(monday.slots[0].members[1].status).toBe('available');
        const next = await activityScheduleService.getMonth(guild, 'self', 1, NOW);
        expect(next.slots[0].selfStatus).toBe('unregistered');
    });

    it('退会者の回答は残し、同じIDの再参加で再び表示する', async () => {
        const month = createMonth();
        setAnswer(month, 'returning', 'available');
        const guild = guildFor();
        const before = await activityScheduleService.getDay(guild, 'self', month.id, '2026-09-07', NOW);
        expect(before.slots[0].members.some(member => member.userId === 'returning')).toBe(false);
        guild.members.cache.set('returning', {
            id: 'returning', displayName: '復帰', user: { id: 'returning', bot: false }
        });
        guild.memberCount += 1;
        const after = await activityScheduleService.getDay(guild, 'self', month.id, '2026-09-07', NOW);
        expect(after.slots[0].members.find(member => member.userId === 'returning').status).toBe('available');
    });

    it('所属がない利用者や不完全なメンバー取得では共有データを返さない', async () => {
        await expect(activityScheduleService.getMonth(guildFor(), 'unknown', 0, NOW))
            .rejects.toMatchObject({ status: 404 });
        const guild = guildFor();
        guild.memberCount += 1;
        guild.members.fetch.mockRejectedValue(new Error('Discord unavailable'));
        await expect(activityScheduleService.getMonth(guild, 'self', 0, NOW)).rejects.toThrow();
    });

    it.each(['available', 'maybe', 'unavailable', 'unset'])('本人の状態 %s を直接、冪等に保存し過去日も許可する', status => {
        const month = createMonth();
        const slot = slotOn(month, '2026-09-01');
        const args = { guildId: GUILD_ID, userId: 'self', monthId: month.id, slotId: slot.id, status };
        expect(activityScheduleService.setStatus(args, NOW)).toEqual({ slotId: slot.id, status });
        expect(activityScheduleService.setStatus(args, NOW)).toEqual({ slotId: slot.id, status });
        expect(availabilityRepository.findUserSlot(GUILD_ID, 'self', slot.id))
            .toMatchObject({ status, source: 'manual' });
        expect(availabilityRepository.findUserSlot(GUILD_ID, 'a', slot.id))
            .toMatchObject({ status: 'unset', source: null });
    });

    it('不正な状態、月、slotや別ギルドのIDを拒否する', async () => {
        const month = createMonth();
        const next = createMonth(2026, 10);
        const other = createMonth(2026, 9, 'other-guild');
        const args = { guildId: GUILD_ID, userId: 'self', monthId: month.id, slotId: slotOn(month).id, status: 'available' };
        expect(() => activityScheduleService.setStatus({ ...args, status: 'unregistered' }, NOW))
            .toThrow(expect.objectContaining({ status: 400 }));
        expect(() => activityScheduleService.setStatus({ ...args, slotId: slotOn(next, '2026-10-01').id }, NOW))
            .toThrow(expect.objectContaining({ status: 404 }));
        expect(() => activityScheduleService.setStatus({ ...args, monthId: other.id }, NOW))
            .toThrow(expect.objectContaining({ status: 404 }));
        expect(() => activityScheduleService.setStatus({ ...args, slotId: -1 }, NOW))
            .toThrow(expect.objectContaining({ status: 400 }));
        await expect(activityScheduleService.getMonth(guildFor(), 'self', 2, NOW))
            .rejects.toMatchObject({ status: 400 });
    });

    it('今月と翌月をギルドタイムゾーンの月境界で判定する', async () => {
        const september = createMonth();
        const october = createMonth(2026, 10);
        const atSeptember = new Date('2026-08-31T15:00:00Z');
        const args = { guildId: GUILD_ID, userId: 'self', monthId: october.id, slotId: slotOn(october, '2026-10-01').id, status: 'available' };
        expect(activityScheduleService.setStatus(args, atSeptember)).toMatchObject({ status: 'available' });
        expect(() => activityScheduleService.setStatus(args, new Date('2026-08-31T14:59:59Z')))
            .toThrow(expect.objectContaining({ status: 400, code: 'MONTH_OUT_OF_RANGE' }));
        const view = await activityScheduleService.getMonth(guildFor(), 'self', 0, atSeptember);
        expect(view.month.id).toBe(september.id);
        expect(view.today).toBe('2026-09-01');
        await expect(activityScheduleService.getDay(guildFor(), 'self', september.id, '2026-09-01', new Date('2026-09-30T15:00:00Z')))
            .rejects.toMatchObject({ status: 400, code: 'MONTH_OUT_OF_RANGE' });
    });

    it.each(['2026-09-31', '2026-09-00', '2026-9-01', '2026-10-01', null])('日付 %s を月の日付として受け付けない', async date => {
        const month = createMonth();
        await expect(activityScheduleService.getDay(guildFor(), 'self', month.id, date, NOW))
            .rejects.toMatchObject({ status: 400, code: 'INVALID_DATE' });
    });

    it('既定JSTではなく設定済みのギルドタイムゾーンを使う', async () => {
        database.connection().prepare(`INSERT INTO guild_settings (
            guild_id, created_at, updated_at, schedule_timezone
        ) VALUES (?, ?, ?, ?)`).run(GUILD_ID, NOW.toISOString(), NOW.toISOString(), 'America/Los_Angeles');
        const view = await activityScheduleService.getMonth(guildFor(), 'self', 0, new Date('2026-09-01T00:00:00Z'));
        expect(view.month).toMatchObject({ year: 2026, month: 8, timezone: 'America/Los_Angeles' });
        expect(view.today).toBe('2026-08-31');
    });

    it('うるう日と年をまたぐ翌月を扱う', async () => {
        const leapNow = new Date('2028-02-01T00:00:00Z');
        const leapMonth = await activityScheduleService.getMonth(guildFor(), 'self', 0, leapNow);
        expect((await activityScheduleService.getDay(guildFor(), 'self', leapMonth.month.id, '2028-02-29', leapNow)).slots).toHaveLength(1);
        const nextYear = await activityScheduleService.getMonth(guildFor(), 'self', 1, new Date('2026-12-15T00:00:00Z'));
        expect(nextYear.month).toMatchObject({ year: 2027, month: 1 });
    });

    it('範囲を両端込みで復元し、基本なしも明示未入力へ戻す', () => {
        setMondayBasic('self', 'available');
        const month = createMonth();
        setAnswer(month, 'self', 'unavailable');
        setAnswer(month, 'self', 'maybe', '2026-09-08');
        setAnswer(month, 'self', 'unavailable', '2026-09-09');
        setAnswer(month, 'a', 'maybe');
        const args = { guildId: GUILD_ID, userId: 'self', monthId: month.id, startDate: '2026-09-07', endDate: '2026-09-08' };
        const preview = activityScheduleService.previewReset(args, NOW);
        expect(preview).toMatchObject({ monthId: month.id, startDate: args.startDate, endDate: args.endDate, slotCount: 2 });
        expect(preview.slots.map(slot => slot.localDate)).toEqual(['2026-09-07', '2026-09-08']);
        expect(preview.slots.every(slot => !Object.hasOwn(slot, 'startMinutes'))).toBe(true);
        expect(activityScheduleService.resetRange({ ...args, revision: preview.revision }, NOW)).toEqual({ slotCount: 2 });
        expect(availabilityRepository.findUserSlot(GUILD_ID, 'self', slotOn(month).id)).toMatchObject({ status: 'available', source: 'basic' });
        expect(availabilityRepository.findUserSlot(GUILD_ID, 'self', slotOn(month, '2026-09-08').id)).toMatchObject({ status: 'unset', source: 'basic' });
        expect(availabilityRepository.findUserSlot(GUILD_ID, 'self', slotOn(month, '2026-09-09').id).status).toBe('unavailable');
        expect(availabilityRepository.findUserSlot(GUILD_ID, 'a', slotOn(month).id).status).toBe('maybe');
    });

    it('確認以降の変更は競合とし、再確認を要求する', () => {
        const month = createMonth();
        const args = { guildId: GUILD_ID, userId: 'self', monthId: month.id, startDate: '2026-09-07', endDate: '2026-09-08' };
        const preview = activityScheduleService.previewReset(args, NOW);
        setAnswer(month, 'self', 'available');
        expect(() => activityScheduleService.resetRange({ ...args, revision: preview.revision }, NOW))
            .toThrow(expect.objectContaining({ status: 409, code: 'RESET_CONFLICT' }));
        expect(availabilityRepository.findUserSlot(GUILD_ID, 'self', slotOn(month).id).status).toBe('available');
        expect(() => activityScheduleService.resetRange(args, NOW))
            .toThrow(expect.objectContaining({ status: 400, code: 'INVALID_REVISION' }));
    });

    it('休日の範囲プレビューは昼夜の両枠を含む', () => {
        const month = createMonth();
        const args = { guildId: GUILD_ID, userId: 'self', monthId: month.id, startDate: '2026-09-05', endDate: '2026-09-06' };
        const preview = activityScheduleService.previewReset(args, NOW);
        expect(preview.slotCount).toBe(4);
        expect(preview.slots.map(slot => [slot.localDate, slot.label])).toEqual([
            ['2026-09-05', '昼'], ['2026-09-05', '夜'], ['2026-09-06', '昼'], ['2026-09-06', '夜']
        ]);
        expect(activityScheduleService.resetRange({ ...args, revision: preview.revision }, NOW)).toEqual({ slotCount: 4 });
    });

    it.each([
        ['2026-09-08', '2026-09-07'], ['2026-09-01', '2026-10-01'],
        ['2026-08-31', '2026-09-01'], ['2026-09-01', '2026-09-31']
    ])('不正範囲 %s ～ %s を拒否する', (startDate, endDate) => {
        const month = createMonth();
        expect(() => activityScheduleService.previewReset({ guildId: GUILD_ID, userId: 'self', monthId: month.id, startDate, endDate }, NOW))
            .toThrow(expect.objectContaining({ status: 400 }));
    });
});

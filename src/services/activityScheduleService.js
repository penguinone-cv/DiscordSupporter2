import availabilityRepository from '../repositories/availabilityRepository.js';
import guildMemberService from './guildMemberService.js';
import scheduleService from './scheduleService.js';
import { currentDateKey, currentYearMonth, daysInMonth, shiftYearMonth } from '../utils/scheduleDate.js';

const EDITABLE_STATUSES = new Set(['available', 'maybe', 'unavailable', 'unset']);

function fail(status, code, message) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    throw error;
}

function positiveId(value) {
    if (!Number.isSafeInteger(value) || value <= 0) {
        fail(400, 'INVALID_ID', '対象の識別子が不正です');
    }
}

function validateDate(month, localDate) {
    const match = typeof localDate === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
    if (!match || Number(match[1]) !== month.year || Number(match[2]) !== month.month
        || Number(match[3]) < 1 || Number(match[3]) > daysInMonth(month.year, month.month)) {
        fail(400, 'INVALID_DATE', '表示月内の正しい日付を指定してください');
    }
}

function slotSummary(slot) {
    return { id: slot.id, localDate: slot.local_date, label: slot.label };
}

function memberName(member, userId) {
    return member.displayName ?? member.nickname ?? member.user?.globalName ?? member.user?.username ?? userId;
}

class ActivityScheduleService {
    validateMonth(guildId, monthId, now) {
        positiveId(monthId);
        const month = availabilityRepository.findMonthById(guildId, monthId);
        if (!month) fail(404, 'MONTH_NOT_FOUND', '対象の月間予定が見つかりません');
        const current = currentYearMonth(now, scheduleService.timezoneForGuild(guildId));
        const next = shiftYearMonth(current.year, current.month, 1);
        if (![current, next].some(target => target.year === month.year && target.month === month.month)) {
            fail(400, 'MONTH_OUT_OF_RANGE', '表示・編集できるのは今月と翌月です');
        }
        return month;
    }

    async loadMembers(guild, userId) {
        const members = await guildMemberService.currentMembers(guild);
        if (!members.has(userId)) fail(404, 'MEMBER_NOT_FOUND', '現在のサーバーメンバーを確認できません');
        return members;
    }

    monthAnswers(guildId, monthId) {
        availabilityRepository.materializeBasicForAllUsers(guildId, monthId);
        const rows = availabilityRepository.listMonthResponses(guildId, monthId);
        const slots = new Map();
        const registered = new Set();
        for (const row of rows) {
            if (!slots.has(row.id)) slots.set(row.id, { slot: row, answers: new Map() });
            if (row.user_id !== null) {
                registered.add(row.user_id);
                slots.get(row.id).answers.set(row.user_id, row.status);
            }
        }
        return { slots, registered };
    }

    statusFor(answers, registered, userId) {
        return answers.get(userId) ?? (registered.has(userId) ? 'unset' : 'unregistered');
    }

    async getMonth(guild, userId, offset = 0, now = new Date()) {
        if (![0, 1].includes(offset)) fail(400, 'MONTH_OUT_OF_RANGE', '表示できるのは今月と翌月です');
        const members = await this.loadMembers(guild, userId);
        const month = scheduleService.getMonthByOffset(guild.id, offset, now);
        const { slots, registered } = this.monthAnswers(guild.id, month.id);
        return {
            month: { id: month.id, year: month.year, month: month.month, timezone: month.timezone },
            today: currentDateKey(now, month.timezone),
            memberCount: members.size,
            slots: [...slots.values()].map(({ slot, answers }) => {
                const counts = { available: 0, maybe: 0, unavailable: 0, unset: 0 };
                for (const memberId of members.keys()) {
                    const status = this.statusFor(answers, registered, memberId);
                    counts[status === 'unregistered' ? 'unset' : status] += 1;
                }
                return {
                    ...slotSummary(slot), dayRule: slot.day_rule, counts,
                    selfStatus: this.statusFor(answers, registered, userId)
                };
            }),
            selfUserId: userId
        };
    }

    async getDay(guild, userId, monthId, localDate, now = new Date()) {
        const month = this.validateMonth(guild.id, monthId, now);
        validateDate(month, localDate);
        const members = await this.loadMembers(guild, userId);
        const memberEntries = [...members].sort(([leftId], [rightId]) => (
            Number(rightId === userId) - Number(leftId === userId)
        ));
        const { slots, registered } = this.monthAnswers(guild.id, monthId);
        return {
            localDate,
            slots: [...slots.values()]
                .filter(({ slot }) => slot.local_date === localDate)
                .map(({ slot, answers }) => ({
                    id: slot.id, label: slot.label,
                    members: memberEntries.map(([memberId, member]) => ({
                        userId: memberId, displayName: memberName(member, memberId),
                        status: this.statusFor(answers, registered, memberId), isSelf: memberId === userId
                    }))
                }))
        };
    }

    setStatus({ guildId, userId, monthId, slotId, status }, now = new Date()) {
        this.validateMonth(guildId, monthId, now);
        positiveId(slotId);
        if (!EDITABLE_STATUSES.has(status)) fail(400, 'INVALID_STATUS', '予定の状態が不正です');
        const slot = availabilityRepository.findUserSlot(guildId, userId, slotId);
        if (!slot || slot.month_id !== monthId) fail(404, 'SLOT_NOT_FOUND', '対象の予定枠が見つかりません');
        availabilityRepository.setUserSlotStatus({ guildId, userId, slotId, status, source: 'manual' });
        return { slotId, status };
    }

    validateRange({ guildId, monthId, startDate, endDate }, now) {
        const month = this.validateMonth(guildId, monthId, now);
        validateDate(month, startDate);
        validateDate(month, endDate);
        if (startDate > endDate) fail(400, 'INVALID_RANGE', '終了日は開始日以降にしてください');
    }

    previewReset(args, now = new Date()) {
        this.validateRange(args, now);
        const { slots, revision } = availabilityRepository.getDateRangeResetPreview(args);
        return {
            monthId: args.monthId, startDate: args.startDate, endDate: args.endDate,
            slotCount: slots.length, revision, slots: slots.map(slotSummary)
        };
    }

    resetRange(args, now = new Date()) {
        this.validateRange(args, now);
        if (typeof args.revision !== 'string' || !/^[a-f0-9]{64}$/.test(args.revision)) {
            fail(400, 'INVALID_REVISION', '対象範囲を確認してから実行してください');
        }
        return { slotCount: availabilityRepository.resetDateRangeToBasic(args) };
    }
}

export default new ActivityScheduleService();

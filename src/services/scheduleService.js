import guildSettingsRepository from '../repositories/guildSettingsRepository.js';
import availabilityRepository from '../repositories/availabilityRepository.js';
import {
    DAY_RULES,
    currentYearMonth,
    dayRuleForDate,
    daysInMonth,
    isRestDayRule,
    shiftYearMonth,
    toDateKey,
    weeksForMonth
} from '../utils/scheduleDate.js';

const BASIC_STATUS_CYCLE = [null, 'available', 'maybe', 'unavailable'];
const MONTH_STATUS_CYCLE = ['unset', 'available', 'maybe', 'unavailable'];

function nextStatus(current, cycle) {
    const index = cycle.indexOf(current);
    return cycle[(index < 0 ? 0 : index + 1) % cycle.length];
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(value, max));
}

class ScheduleService {
    timezoneForGuild(guildId) {
        return guildSettingsRepository.find(guildId)?.schedule_timezone || 'Asia/Tokyo';
    }

    ensureMonth(guildId, year, month) {
        const timezone = this.timezoneForGuild(guildId);
        const templates = availabilityRepository.ensureDefaultTemplates(guildId);
        const availabilityMonth = availabilityRepository.ensureMonth(
            guildId,
            year,
            month,
            timezone
        );
        const slots = [];
        for (let day = 1; day <= daysInMonth(year, month); day += 1) {
            const localDate = toDateKey(year, month, day);
            const dayRule = dayRuleForDate(localDate);
            const dayKind = isRestDayRule(dayRule) ? 'rest_day' : 'weekday';
            for (const template of templates.filter(item => item.day_kind === dayKind)) {
                slots.push({
                    templateId: template.id,
                    localDate,
                    dayRule,
                    label: template.label,
                    startMinutes: template.start_minutes,
                    endMinutes: template.end_minutes,
                    sortOrder: template.sort_order
                });
            }
        }
        availabilityRepository.insertSlots(availabilityMonth.id, slots);
        availabilityRepository.materializeBasicForAllUsers(guildId, availabilityMonth.id);
        return availabilityMonth;
    }

    ensureCurrentAndNext(guildId, now = new Date()) {
        const timezone = this.timezoneForGuild(guildId);
        const current = currentYearMonth(now, timezone);
        const next = shiftYearMonth(current.year, current.month, 1);
        return [
            this.ensureMonth(guildId, current.year, current.month),
            this.ensureMonth(guildId, next.year, next.month)
        ];
    }

    getMonthByOffset(guildId, offset = 0, now = new Date()) {
        if (![0, 1].includes(offset)) throw new Error('表示できるのは今月と翌月です');
        const timezone = this.timezoneForGuild(guildId);
        const current = currentYearMonth(now, timezone);
        const target = shiftYearMonth(current.year, current.month, offset);
        return this.ensureMonth(guildId, target.year, target.month);
    }

    getMonth(guildId, monthId) {
        const month = availabilityRepository.findMonthById(guildId, monthId);
        if (!month) throw new Error('対象の月間予定が見つかりません');
        return month;
    }

    getBasicDay(guildId, userId, requestedPage = 0) {
        const templates = availabilityRepository.ensureDefaultTemplates(guildId);
        const page = clamp(requestedPage, 0, DAY_RULES.length - 1);
        const dayRule = DAY_RULES[page];
        const expectedKind = isRestDayRule(dayRule) ? 'rest_day' : 'weekday';
        const patterns = new Map(
            availabilityRepository.listBasicPatterns(guildId, userId, dayRule)
                .map(pattern => [pattern.template_id, pattern.status])
        );
        return {
            page,
            pages: DAY_RULES.length,
            dayRule,
            templates: templates
                .filter(template => template.day_kind === expectedKind)
                .map(template => ({
                    ...template,
                    status: patterns.get(template.id) ?? null
                }))
        };
    }

    cycleBasicStatus({ guildId, userId, requestedPage, templateId }) {
        const day = this.getBasicDay(guildId, userId, requestedPage);
        const template = day.templates.find(item => item.id === templateId);
        if (!template) throw new Error('対象の基本予定時間枠が見つかりません');
        const status = nextStatus(template.status, BASIC_STATUS_CYCLE);
        availabilityRepository.setBasicStatus({
            guildId,
            userId,
            dayRule: day.dayRule,
            templateId,
            status
        });
        return this.getBasicDay(guildId, userId, day.page);
    }

    getUserMonth(guildId, userId, monthId, requestedWeek = 0) {
        const month = this.getMonth(guildId, monthId);
        availabilityRepository.materializeBasicForUser(guildId, userId, month.id);
        const slots = availabilityRepository.listUserMonthSlots(guildId, userId, month.id);
        const weeks = weeksForMonth(month.year, month.month);
        const week = clamp(requestedWeek, 0, weeks.length - 1);
        const dates = weeks[week];
        const dateSet = new Set(dates);
        const slotsByDate = new Map(dates.map(date => [date, []]));
        for (const slot of slots) {
            if (dateSet.has(slot.local_date)) slotsByDate.get(slot.local_date).push(slot);
        }
        return {
            month,
            week,
            weeks: weeks.length,
            dates,
            slotsByDate
        };
    }

    getUserDay(guildId, userId, monthId, requestedWeek, localDate) {
        const view = this.getUserMonth(guildId, userId, monthId, requestedWeek);
        if (!view.dates.includes(localDate)) throw new Error('対象の日付がこの週に含まれていません');
        return { ...view, localDate, slots: view.slotsByDate.get(localDate) ?? [] };
    }

    cycleMonthStatus({ guildId, userId, monthId, requestedWeek, localDate, slotId }) {
        const view = this.getUserDay(guildId, userId, monthId, requestedWeek, localDate);
        const slot = view.slots.find(item => item.id === slotId);
        if (!slot) throw new Error('対象の日時枠が見つかりません');
        const status = nextStatus(slot.status, MONTH_STATUS_CYCLE);
        availabilityRepository.setUserSlotStatus({
            guildId,
            userId,
            slotId,
            status,
            source: 'manual'
        });
        return this.getUserDay(guildId, userId, monthId, view.week, localDate);
    }

    resetWeekToBasic({ guildId, userId, monthId, requestedWeek }) {
        const view = this.getUserMonth(guildId, userId, monthId, requestedWeek);
        availabilityRepository.resetDateRangeToBasic({
            guildId,
            userId,
            monthId,
            startDate: view.dates[0],
            endDate: view.dates.at(-1)
        });
        return this.getUserMonth(guildId, userId, monthId, view.week);
    }
}

export { BASIC_STATUS_CYCLE, MONTH_STATUS_CYCLE };
export default new ScheduleService();

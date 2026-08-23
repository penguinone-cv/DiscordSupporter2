import holidayJp from '@holiday-jp/holiday_jp';

export const DAY_RULES = ['1', '2', '3', '4', '5', '6', '0', 'holiday'];

export const DAY_RULE_LABELS = {
    0: '日曜日',
    1: '月曜日',
    2: '火曜日',
    3: '水曜日',
    4: '木曜日',
    5: '金曜日',
    6: '土曜日',
    holiday: '祝日'
};

export const SHORT_WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

export function toDateKey(year, month, day) {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseDateKey(dateKey) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
    if (!match) throw new Error('不正な日付です');
    return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function weekdayForDate(dateKey) {
    const { year, month, day } = parseDateKey(dateKey);
    return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function isJapaneseHoliday(dateKey) {
    const { year, month, day } = parseDateKey(dateKey);
    return holidayJp.isHoliday(new Date(Date.UTC(year, month - 1, day)));
}

export function dayRuleForDate(dateKey) {
    if (isJapaneseHoliday(dateKey)) return 'holiday';
    return String(weekdayForDate(dateKey));
}

export function isRestDayRule(dayRule) {
    return dayRule === '0' || dayRule === '6' || dayRule === 'holiday';
}

export function daysInMonth(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function weeksForMonth(year, month) {
    const weeks = [];
    let current = [];
    for (let day = 1; day <= daysInMonth(year, month); day += 1) {
        const dateKey = toDateKey(year, month, day);
        const weekday = weekdayForDate(dateKey);
        if (weekday === 1 && current.length) {
            weeks.push(current);
            current = [];
        }
        current.push(dateKey);
    }
    if (current.length) weeks.push(current);
    return weeks;
}

export function currentYearMonth(now = new Date(), timezone = 'Asia/Tokyo') {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: 'numeric'
    }).formatToParts(now);
    const value = type => Number(parts.find(part => part.type === type)?.value);
    return { year: value('year'), month: value('month') };
}

export function currentDateKey(now = new Date(), timezone = 'Asia/Tokyo') {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric'
    }).formatToParts(now);
    const value = type => Number(parts.find(part => part.type === type)?.value);
    return toDateKey(value('year'), value('month'), value('day'));
}

export function shiftYearMonth(year, month, offset) {
    const shifted = new Date(Date.UTC(year, month - 1 + offset, 1));
    return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1 };
}

export function formatMinutes(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

export function formatDateLabel(dateKey, { includeYear = false } = {}) {
    const { year, month, day } = parseDateKey(dateKey);
    const weekday = SHORT_WEEKDAY_LABELS[weekdayForDate(dateKey)];
    return `${includeYear ? `${year}年` : ''}${month}月${day}日（${weekday}）`;
}

/**
 * IANAタイムゾーン上のローカル日付・時刻を、同じ瞬間を表すDateへ変換する。
 * 候補日時とリマインド時刻をサーバーの予定タイムゾーンどおりに扱うために使う。
 */
export function dateAtMinutesInTimeZone(dateKey, minutes, timeZone = 'Asia/Tokyo') {
    const { year, month, day } = parseDateKey(dateKey);
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1439) {
        throw new Error('不正な時刻です');
    }

    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
    const formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
    });

    const localParts = timestamp => {
        const values = Object.fromEntries(
            formatter.formatToParts(new Date(timestamp))
                .filter(part => part.type !== 'literal')
                .map(part => [part.type, Number(part.value)])
        );
        return {
            year: values.year,
            month: values.month,
            day: values.day,
            hour: values.hour,
            minute: values.minute,
            second: values.second
        };
    };

    // UTCを仮定した値からタイムゾーンのオフセットを反復補正する。
    let timestamp = targetAsUtc;
    for (let attempt = 0; attempt < 4; attempt += 1) {
        const parts = localParts(timestamp);
        const representedAsUtc = Date.UTC(
            parts.year,
            parts.month - 1,
            parts.day,
            parts.hour,
            parts.minute,
            parts.second
        );
        const adjusted = targetAsUtc - (representedAsUtc - timestamp);
        if (adjusted === timestamp) break;
        timestamp = adjusted;
    }

    const actual = localParts(timestamp);
    if (
        actual.year !== year
        || actual.month !== month
        || actual.day !== day
        || actual.hour !== hour
        || actual.minute !== minute
        || actual.second !== 0
    ) {
        throw new Error('指定タイムゾーンに存在しない日時です');
    }
    return new Date(timestamp);
}

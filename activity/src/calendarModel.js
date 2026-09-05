export const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
export const STATUSES = ['available', 'maybe', 'unavailable', 'unset'];
const LABELS = { available: '○ 参加可能', maybe: '△ 未定', unavailable: '× 参加不可', unset: '― 未入力', unregistered: '未登録' };
const key = date => date.toISOString().slice(0, 10);

export function buildMonthGrid(year, month, today) {
    const first = new Date(Date.UTC(year, month - 1, 1));
    const start = 1 - first.getUTCDay();
    return Array.from({ length: 42 }, (_, index) => {
        const date = new Date(Date.UTC(year, month - 1, start + index));
        return { date: key(date), day: date.getUTCDate(), inMonth: date.getUTCMonth() === month - 1, isToday: key(date) === today };
    });
}

export function selectedRange(first, last, year, month) {
    const allowed = new Set(buildMonthGrid(year, month).filter(cell => cell.inMonth).map(cell => cell.date));
    if (!allowed.has(first) || !allowed.has(last)) throw new Error('表示中の月の日付を選んでください');
    const [startDate, endDate] = [first, last].sort();
    return { startDate, endDate };
}

export const statusLabel = status => LABELS[status] ?? LABELS.unset;
export const slotLabel = slot => slot.label;

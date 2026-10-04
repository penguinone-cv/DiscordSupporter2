import { element } from './view.js';
import { buildMonthGrid, WEEKDAYS } from './calendarModel.js';

const button = (label, action, attrs = {}) => element('button', { type: 'button', onClick: action, ...attrs }, label);

export function renderConfirmed(root, state, actions) {
    const focusKey = document.activeElement?.getAttribute('data-key');
    const scroll = root.querySelector('.sheet')?.scrollTop ?? 0;
    const hadDialog = Boolean(root.querySelector('[role=dialog]'));
    if (state.layoutMode !== 0) {
        root.replaceChildren(element('main', { className: 'notice compact' }, element('h1', {}, '確定済み予定'), element('p', {}, '全画面表示で確定済み予定を確認してください')));
        return;
    }
    const data = state.data;
    const modal = Boolean(state.date && data);
    const select = element('select', { id: 'confirmed-channel', 'data-key': 'channel', disabled: state.loading || !data, onChange: event => actions.selectChannel(event.target.value) },
        element('option', { value: '' }, 'すべてのチャンネル'), (data?.channels ?? []).map(channel => element('option', { value: channel.id }, `#${channel.name}`)));
    select.value = state.channelId;
    const feedback = element('p', { role: 'status', 'aria-live': 'polite', className: `feedback${state.error ? ' error' : ''}` }, state.error || (state.loading ? '読み込んでいます…' : ''));
    feedback.hidden = !feedback.textContent;
    const main = element('main', { className: 'calendar-app confirmed-app', inert: modal },
        element('header', { className: 'page-header' }, element('h1', {}, '確定済み予定'), element('span', { className: 'timezone' }, data?.month.timezone)),
        element('div', { className: 'toolbar' },
            element('label', { for: 'confirmed-channel' }, 'チャンネル ', select),
            element('div', { className: 'month-switch', role: 'group', 'aria-label': '表示する月' },
                button('前月', () => actions.changeMonth(-1), { disabled: state.year === null || (state.year === 1000 && state.month === 1), 'data-key': 'previous-month' }),
                button('今月', actions.currentMonth, { 'data-key': 'current-month' }),
                button('翌月', () => actions.changeMonth(1), { disabled: state.year === null || (state.year === 9999 && state.month === 12), 'data-key': 'next-month' })),
            button('更新', actions.refresh, { disabled: state.loading, 'data-key': 'refresh' })),
        element('p', { className: 'legend' }, 'リマインドで登録された予定を表示します。チャンネルを選ぶとメンバーの関連予定も確認できます。'));
    if (data) {
        main.append(element('h2', { id: 'confirmed-month' }, `${data.month.year}年 ${data.month.month}月`));
        if (!data.events.length && !data.relatedEvents.length) main.append(element('p', {}, 'この月の確定済み予定はありません。'));
        const events = [...data.events, ...data.relatedEvents];
        const grid = element('div', { className: 'calendar-grid', role: 'grid', 'aria-labelledby': 'confirmed-month' });
        grid.append(element('div', { role: 'row', className: 'week-row weekday-row' }, WEEKDAYS.map(day => element('div', { role: 'columnheader' }, day))));
        const cells = buildMonthGrid(data.month.year, data.month.month, data.today);
        for (let row = 0; row < 6; row++) {
            grid.append(element('div', { role: 'row', className: 'week-row' }, cells.slice(row * 7, row * 7 + 7).map(cell => {
                if (!cell.inMonth) return element('div', { role: 'gridcell', className: 'day-cell outside' }, cell.day);
                const dayEvents = events.filter(event => event.localDate === cell.date);
                return element('div', { role: 'gridcell', className: 'day-cell' }, button([
                    element('span', { className: 'day-number' }, cell.day),
                    dayEvents.slice(0, 2).map(event => element('span', { className: `confirmed-summary${event.memberNames ? ' related' : ''}` },
                        element('span', { className: 'slot-label' }, `${event.memberNames ? '関連 ' : ''}#${event.channelName}`),
                        element('span', { className: 'confirmed-preview' }, event.content))),
                    dayEvents.length > 2 ? element('small', {}, `ほか${dayEvents.length - 2}件`) : null
                ], () => actions.selectDate(cell.date), {
                    className: `day-button${cell.isToday ? ' today' : ''}`, 'data-date': cell.date, 'data-key': cell.date,
                    'aria-label': `${cell.date} 確定済み予定 ${dayEvents.length}件`, disabled: !dayEvents.length
                }));
            })));
        }
        main.append(grid);
    }
    root.replaceChildren(main);
    if (!modal) root.append(feedback);
    else {
        const dayEvents = [...data.events, ...data.relatedEvents].filter(event => event.localDate === state.date);
        const sheet = element('section', { className: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'confirmed-detail', tabindex: '-1' },
            element('div', { className: 'sheet-heading' }, element('h2', { id: 'confirmed-detail' }, state.date), button('閉じる', actions.close, { 'data-key': 'close' })),
            feedback, dayEvents.length ? dayEvents.map(event => element('section', { className: 'day-slot' },
                element('h3', {}, `${event.memberNames ? '関連予定 ' : ''}#${event.channelName}`),
                element('p', { className: 'confirmed-content' }, event.content),
                event.memberNames ? element('p', { className: 'muted' }, `関連メンバー: ${event.memberNames.join('、')}`) : null))
                : element('p', {}, 'この日の確定済み予定はなくなりました。'));
        root.append(element('div', { className: 'backdrop', onClick: event => { if (event.target === event.currentTarget) actions.close(); } }, sheet));
        sheet.scrollTop = scroll;
        if (!hadDialog) sheet.querySelector('button').focus();
    }
    if (focusKey) [...root.querySelectorAll('[data-key]')].find(node => node.dataset.key === focusKey)?.focus({ preventScroll: true });
}

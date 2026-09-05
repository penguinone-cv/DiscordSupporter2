import { buildMonthGrid, STATUSES, slotLabel, statusLabel, WEEKDAYS } from './calendarModel.js';

function element(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (value === false || value == null) continue;
        if (key === 'className') node.className = value;
        else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
        else node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children.flat(Infinity)) if (child != null) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    return node;
}
const button = (text, action, attrs = {}) => element('button', { type: 'button', ...attrs, onClick: action }, text);

export function showNotice(root, text, retry) {
    root.replaceChildren(element('main', { className: 'notice' }, element('h1', {}, '月間予定'), element('p', { role: 'status' }, text), retry ? button('再試行', retry) : null));
}

export function renderSchedule(root, state, actions) {
    if (!state.data) { showNotice(root, state.error || '予定を読み込んでいます…', state.error ? actions.refresh : null); return; }
    const { month, today, slots, memberCount } = state.data;
    const activeKey = document.activeElement?.getAttribute('data-key');
    if (activeKey) state.focusKey = activeKey;
    const previousScroll = root.querySelector('.sheet')?.scrollTop ?? 0;
    const hadDialog = Boolean(root.querySelector('[role=dialog]'));
    if (state.layoutMode !== 0) {
        root.replaceChildren(element('main', { className: 'notice compact' }, element('h1', {}, `${month.month}月の予定`), element('p', {}, `${memberCount}人で共有中`), element('p', {}, '全画面表示で予定を確認・編集してください')));
        return;
    }
    const modal = Boolean(state.day || state.preview);
    const main = element('main', { className: 'calendar-app', inert: modal },
        element('header', { className: 'page-header' }, element('div', {}, element('h1', {}, '月間予定'), element('p', { className: 'muted' }, `${memberCount}人の予定 · 自分の予定だけ編集できます`)),
            element('span', { className: 'timezone' }, month.timezone)),
        element('div', { className: 'toolbar' },
            element('div', { className: 'month-switch', role: 'group', 'aria-label': '表示する月' },
                button('今月', () => actions.changeMonth(0), { 'aria-pressed': String(state.offset === 0), 'data-key': 'month-0', disabled: state.busy }),
                element('h2', { id: 'month-title' }, `${month.year}年 ${month.month}月`),
                button('翌月', () => actions.changeMonth(1), { 'aria-pressed': String(state.offset === 1), 'data-key': 'month-1', disabled: state.busy })),
            element('div', { className: 'toolbar-actions' }, button(state.rangeStart !== null ? '範囲選択をやめる' : '範囲を基本予定へ戻す', actions.beginRange, { 'data-action': 'range', 'data-key': 'range', disabled: state.busy || Boolean(state.error) }), button('更新', actions.refresh, { 'data-key': 'refresh', disabled: state.busy }))),
        element('p', { className: 'legend' }, '○ 参加可能　△ 未定　× 参加不可　未 未入力・未登録'),
        state.rangeStart !== null ? element('p', { className: 'range-hint' }, state.rangeStart ? `${state.rangeStart} を選択中。終了日を押してください。` : '開始日と終了日を順に押してください。同じ日を2回押すと1日だけ選べます。') : null
    );
    const grid = element('div', { className: 'calendar-grid', role: 'grid', 'aria-labelledby': 'month-title' });
    grid.append(element('div', { role: 'row', className: 'week-row weekday-row' }, WEEKDAYS.map(name => element('div', { role: 'columnheader' }, name))));
    const cells = buildMonthGrid(month.year, month.month, today);
    for (let row = 0; row < 6; row++) {
        grid.append(element('div', { role: 'row', className: 'week-row' }, cells.slice(row * 7, row * 7 + 7).map(cell => {
            if (!cell.inMonth) return element('div', { role: 'gridcell', className: 'day-cell outside', 'aria-disabled': 'true' }, cell.day);
            const daySlots = slots.filter(slot => slot.localDate === cell.date);
            const selected = state.range && cell.date >= state.range.startDate && cell.date <= state.range.endDate;
            const dayButton = element('button', { type: 'button', className: `day-button${cell.isToday ? ' today' : ''}${selected || cell.date === state.rangeStart ? ' selected' : ''}`, 'data-date': cell.date, 'data-key': `date-${cell.date}`, 'aria-label': `${cell.date}${cell.isToday ? ' 今日' : ''} ${daySlots.map(slot => `${slotLabel(slot)} ○${slot.counts.available} △${slot.counts.maybe} ×${slot.counts.unavailable} 未${slot.counts.unset}`).join('、')}`, disabled: state.busy, onClick: () => actions.selectDate(cell.date) },
                element('span', { className: 'day-number' }, cell.day, daySlots.some(slot => slot.dayRule === 'holiday') ? element('small', {}, '祝') : null),
                daySlots.map(slot => element('span', { className: 'slot-summary' }, element('span', { className: 'slot-label' }, slot.label), element('span', { className: 'counts' }, ['available', 'maybe', 'unavailable', 'unset'].map((status, index) => element('span', { className: status }, `${['○','△','×','未'][index]}${slot.counts[status]}`)))))
            );
            return element('div', { role: 'gridcell', className: 'day-cell', 'aria-selected': String(Boolean(selected)) }, dayButton);
        })));
    }
    main.append(grid);
    const feedback = element('div', { className: `feedback${state.error ? ' error' : ''}`, role: 'status', 'aria-live': 'polite' }, state.busy ? '保存・読み込み中…' : state.error || state.message || '変更は自動で保存されます');
    root.replaceChildren(main);
    if (!modal) root.append(feedback);
    if (modal) {
        const sheet = element('section', { className: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sheet-title', tabindex: '-1' });
        sheet.append(element('div', { className: 'sheet-heading' }, element('h2', { id: 'sheet-title' }, state.preview ? '基本予定に戻しますか？' : state.day.localDate), button('閉じる', actions.close, { 'data-key': 'close', 'aria-label': '詳細を閉じる', disabled: state.busy })));
        sheet.append(feedback);
        if (state.preview) {
            sheet.append(element('p', {}, `${state.preview.startDate} 〜 ${state.preview.endDate}`), element('p', {}, `昼・夜を含む${state.preview.slotCount}枠を、現在の基本予定に戻します。基本予定のない枠は未入力になります。この操作は取り消せません。`),
                element('ul', { className: 'reset-slots' }, state.preview.slots.map(slot => element('li', {}, `${slot.localDate} ${slotLabel(slot)}`))),
                button('基本予定に戻す', actions.confirmReset, { className: 'primary', 'data-action': 'confirm-reset', 'data-key': 'confirm-reset', disabled: state.busy || Boolean(state.error) }));
        } else {
            for (const slot of state.day.slots) {
                const section = element('section', { className: 'day-slot' }, element('h3', {}, slotLabel(slot)));
                for (const member of slot.members) {
                    const row = element('div', { className: `member-row${member.isSelf ? ' self' : ''}` }, element('div', { className: 'member-heading' }, element('span', { className: 'member-name' }, member.displayName, member.isSelf ? '（あなた）' : ''), element('span', { className: member.status }, statusLabel(member.status))));
                    if (member.isSelf) row.append(element('div', { className: 'status-options', role: 'group', 'aria-label': `${slotLabel(slot)}の自分の予定` }, STATUSES.map(status => button(statusLabel(status), () => actions.save(slot.id, status), { 'data-status': status, 'data-key': `status-${slot.id}-${status}`, 'aria-pressed': String(member.status === status), disabled: state.busy }))));
                    section.append(row);
                }
                sheet.append(section);
            }
        }
        const backdrop = element('div', { className: 'backdrop', onClick: event => { if (event.target === event.currentTarget) actions.close(); } }, sheet);
        root.append(backdrop);
        sheet.scrollTop = previousScroll;
        const restore = [...sheet.querySelectorAll('[data-key]')].find(node => node.dataset.key === state.focusKey && !node.disabled);
        if (state.busy) sheet.focus({ preventScroll: true });
        else if (restore) restore.focus({ preventScroll: true });
        else if (!hadDialog || !sheet.contains(document.activeElement)) sheet.querySelector('button')?.focus({ preventScroll: true });
    }
    if (!modal && activeKey) [...root.querySelectorAll('[data-key]')].find(node => node.dataset.key === activeKey)?.focus({ preventScroll: true });
}

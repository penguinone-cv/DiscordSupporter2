import { element } from './view.js';
import { buildMonthGrid, WEEKDAYS } from './calendarModel.js';

const button = (label, action, attrs = {}) => element('button', { type: 'button', onClick: action, ...attrs }, label);
const counts = slot => `○ ${slot.availableCount}人 / △ ${slot.maybeCount}人 / × ${slot.unavailableCount}人`;
const status = { available: '○', maybe: '△', unavailable: '×' };
const recruitmentLabel = { pending: '投稿処理中', open: '募集中', confirmed: '開催確定' };

export function renderCandidates(root, state, actions) {
    const focusKey = document.activeElement?.getAttribute('data-key');
    const scroll = root.querySelector('.sheet')?.scrollTop ?? 0;
    const hadDialog = Boolean(root.querySelector('[role=dialog]'));
    if (state.layoutMode !== 0) {
        root.replaceChildren(element('main', { className: 'notice' }, element('h1', {}, '候補日確認'), element('p', {}, '全画面表示で候補日を確認してください')));
        return;
    }
    const data = state.data;
    const selected = data?.candidates.filter(slot => slot.localDate === state.date) ?? [];
    const modal = Boolean(state.date && data);
    const feedback = element('p', { role: 'status', 'aria-live': 'polite', className: `feedback${state.error ? ' error' : ''}` }, state.busy ? '投稿しています…' : state.error || state.message || (state.loading ? '読み込んでいます…' : ''));
    feedback.hidden = !feedback.textContent;
    const select = element('select', { id: 'candidate-game', 'data-key': 'game', disabled: state.busy, onChange: event => actions.selectGame(event.target.value) },
        element('option', { value: '' }, 'ゲームを選択'), state.games.map(game => element('option', { value: game.id }, game.displayName)));
    select.value = state.gameId;
    const main = element('main', { className: 'calendar-app candidate-app', inert: modal },
        element('header', { className: 'page-header' }, element('h1', {}, '候補日確認'), element('span', { className: 'timezone' }, data?.month.timezone)),
        element('div', { className: 'toolbar' },
            element('label', { for: 'candidate-game' }, 'ゲーム ', select),
            element('div', { className: 'month-switch', role: 'group', 'aria-label': '表示する月' },
                button('今月', () => actions.changeMonth(0), { 'aria-pressed': String(state.offset === 0), disabled: state.busy, 'data-key': 'month-0' }),
                button('翌月', () => actions.changeMonth(1), { 'aria-pressed': String(state.offset === 1), disabled: state.busy, 'data-key': 'month-1' })),
            button('更新', actions.refresh, { disabled: state.busy || state.loading, 'data-key': 'refresh' })),
        element('p', { className: 'legend' }, '○ 参加可能　△ 未定　× 参加不可 · ゲーム希望者の回答を表示します'));
    if (!state.games.length && !state.loading) main.append(element('p', {}, '候補を確認できる稼働中ゲームはありません。'));
    else if (!state.gameId) main.append(element('p', {}, 'ゲームを選択してください。'));
    if (data) {
        main.append(element('h2', { id: 'candidate-month' }, `${data.month.year}年 ${data.month.month}月 · ${data.game.displayName}`));
        if (!data.candidates.length) main.append(element('p', {}, '当日以降の○または△の候補日程はありません。'));
        const grid = element('div', { className: 'calendar-grid', role: 'grid', 'aria-labelledby': 'candidate-month' });
        grid.append(element('div', { role: 'row', className: 'week-row weekday-row' }, WEEKDAYS.map(day => element('div', { role: 'columnheader' }, day))));
        const cells = buildMonthGrid(data.month.year, data.month.month, data.today);
        for (let row = 0; row < 6; row++) {
            grid.append(element('div', { role: 'row', className: 'week-row' }, cells.slice(row * 7, row * 7 + 7).map(cell => {
                if (!cell.inMonth) return element('div', { role: 'gridcell', className: 'day-cell outside' }, cell.day);
                const slots = data.candidates.filter(slot => slot.localDate === cell.date);
                return element('div', { role: 'gridcell', className: 'day-cell' }, button([
                    element('span', { className: 'day-number' }, cell.day),
                    slots.map(slot => element('span', { className: 'slot-summary' },
                        element('span', { className: 'slot-label' }, slot.label),
                        element('span', { className: 'counts candidate-counts' },
                            element('span', { className: 'available' }, `○${slot.availableCount}`),
                            element('span', { className: 'maybe' }, `△${slot.maybeCount}`),
                            element('span', { className: 'unavailable' }, `×${slot.unavailableCount}`)),
                        slot.recruitment ? element('small', {}, recruitmentLabel[slot.recruitment.status] ?? '募集済み') : null))
                ], () => actions.selectDate(cell.date), {
                    className: `day-button${cell.isToday ? ' today' : ''}`, 'data-date': cell.date, 'data-key': cell.date,
                    'aria-label': `${cell.date} ${slots.map(slot => `${slot.label} ${counts(slot)}`).join('、') || '候補なし'}`,
                    disabled: !slots.length || state.busy
                }));
            })));
        }
        main.append(grid);
    }
    root.replaceChildren(main);
    if (!modal) {
        if (feedback.textContent) root.append(feedback);
    } else {
        const sheet = element('section', { className: 'sheet candidate-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'candidate-detail', tabindex: '-1' },
            element('div', { className: 'sheet-heading' }, element('h2', { id: 'candidate-detail' }, `${state.date} · ${data.game.displayName}`), button('閉じる', actions.close, { 'data-key': 'close', disabled: state.busy })),
            feedback, element('p', {}, `投稿先：ゲーム「${data.game.displayName}」のチャンネル`),
            selected.length ? selected.map(slot => element('section', { className: 'day-slot' },
                element('h3', {}, slot.label), element('p', {}, counts(slot)),
                element('ul', {}, slot.members.map(member => element('li', {}, `${status[member.status]} ${member.displayName}`))),
                button(slot.recruitment ? recruitmentLabel[slot.recruitment.status] ?? '募集済み' : `この日程で募集する（${slot.label}）`, () => actions.recruit(slot.slotId), {
                    className: 'primary', 'data-recruit': slot.slotId, 'data-key': `recruit-${slot.slotId}`,
                    disabled: state.busy || state.loading || Boolean(state.error) || Boolean(slot.recruitment)
                }))) : element('p', {}, 'この日の候補はなくなりました。別の日程を選択してください。'));
        root.append(element('div', { className: 'backdrop' }, sheet));
        sheet.scrollTop = scroll;
        if (!hadDialog) sheet.focus();
    }
    if (focusKey) [...root.querySelectorAll('[data-key]')].find(node => node.dataset.key === focusKey)?.focus();
}

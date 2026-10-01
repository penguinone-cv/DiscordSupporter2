import { renderConfirmed } from './confirmedView.js';

export function createConfirmedApp(root, { api, pollMs = 5000, onBusy = () => {} } = {}) {
    const state = { year: null, month: null, channelId: '', data: null, date: null, loading: false, error: '', layoutMode: -1 };
    let started = false, destroyed = false, generation = 0, timer;
    const canPoll = () => started && !destroyed && !document.hidden && state.layoutMode === 0;
    const render = () => { if (!destroyed) { onBusy(Boolean(state.date)); renderConfirmed(root, state, actions); } };
    function schedule() {
        clearTimeout(timer);
        if (canPoll()) timer = setTimeout(() => void refresh(), pollMs);
    }
    async function refresh() {
        if (destroyed) return;
        const current = ++generation;
        const query = new URLSearchParams();
        if (state.year !== null) { query.set('year', state.year); query.set('month', state.month); }
        if (state.channelId) query.set('channelId', state.channelId);
        clearTimeout(timer); state.loading = true; render();
        try {
            const data = await api.request(`/calendar${query.size ? `?${query}` : ''}`);
            if (destroyed || current !== generation) return;
            if (state.data && (state.data.month.year !== data.month.year || state.data.month.month !== data.month.month)) state.date = null;
            state.data = data; state.year = data.month.year; state.month = data.month.month; state.error = '';
        } catch (error) {
            if (destroyed || current !== generation) return;
            state.error = error.message;
            // Do not leave previously authorized content visible after access has been revoked.
            if ([401, 403, 404].includes(error.status)) { state.data = null; state.date = null; }
            if (error.status === 404) state.channelId = '';
        } finally {
            if (!destroyed && current === generation) { state.loading = false; render(); schedule(); }
        }
    }
    async function changeMonth(delta) {
        if (destroyed || state.layoutMode !== 0 || state.date || state.year === null) return;
        const date = new Date(Date.UTC(state.year, state.month - 1 + delta, 1));
        if (date.getUTCFullYear() < 1000 || date.getUTCFullYear() > 9999) return;
        state.year = date.getUTCFullYear(); state.month = date.getUTCMonth() + 1; state.data = null; state.error = '';
        await refresh();
    }
    async function currentMonth() {
        if (destroyed || state.layoutMode !== 0 || state.date) return;
        state.year = null; state.month = null; state.data = null; state.error = '';
        await refresh();
    }
    async function selectChannel(id) {
        if (destroyed || state.layoutMode !== 0 || state.date) return;
        state.channelId = id; state.data = null; state.error = '';
        await refresh();
    }
    function selectDate(date) {
        if (destroyed || state.layoutMode !== 0 || !state.data
            || ![...state.data.events, ...state.data.relatedEvents].some(event => event.localDate === date)) return;
        state.date = date; render();
    }
    function close() {
        const date = state.date; state.date = null; render();
        [...root.querySelectorAll('[data-date]')].find(node => node.dataset.date === date)?.focus();
    }
    const actions = { refresh, changeMonth, currentMonth, selectChannel, selectDate, close };
    function onVisibility() { clearTimeout(timer); if (canPoll()) void refresh(); }
    function onKey(event) {
        if (event.key === 'Escape' && state.date) { close(); return; }
        const dialog = root.querySelector('[role=dialog]');
        if (dialog && event.key === 'Tab') {
            event.preventDefault(); dialog.querySelector('button')?.focus();
        }
        const shift = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
        if (!dialog && shift && event.target.dataset.date) {
            const targets = [...root.querySelectorAll('[data-date]')];
            let index = targets.indexOf(event.target) + shift;
            while (targets[index]?.disabled) index += shift;
            if (targets[index]) { event.preventDefault(); targets[index].focus(); }
        }
    }
    root.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVisibility); window.addEventListener('focus', onVisibility);
    return {
        async start() { started = true; if (canPoll()) await refresh(); else render(); }, ...actions,
        setLayoutMode(mode) { const changed = state.layoutMode !== mode; state.layoutMode = mode; render(); clearTimeout(timer); if (changed && canPoll()) void refresh(); },
        destroy() { destroyed = true; generation++; clearTimeout(timer); root.removeEventListener('keydown', onKey); document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('focus', onVisibility); }
    };
}

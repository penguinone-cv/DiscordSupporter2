import { renderCandidates } from './candidateView.js';

export function createCandidateApp(root, { api, pollMs = 5000, onBusy = () => {} } = {}) {
    const state = { games: [], gameId: '', offset: 0, data: null, date: null, loading: false, busy: false, error: '', message: '', layoutMode: -1 };
    let started = false, destroyed = false, generation = 0, timer;
    const canPoll = () => started && !destroyed && !document.hidden && state.layoutMode === 0;
    const render = () => { if (!destroyed) { onBusy(state.busy || Boolean(state.date)); renderCandidates(root, state, actions); } };
    function schedule() {
        clearTimeout(timer);
        if (canPoll()) timer = setTimeout(() => { if (!state.busy) void refresh(); else schedule(); }, pollMs);
    }
    async function refresh({ keepError = false } = {}) {
        if (destroyed) return;
        const current = ++generation;
        clearTimeout(timer); state.loading = true; render();
        try {
            if (state.gameId) {
                const data = await api.request(`/candidates?offset=${state.offset}&gameId=${state.gameId}`);
                if (destroyed || current !== generation) return;
                if (state.data && state.data.month.id !== data.month.id) state.date = null;
                state.data = data;
            } else {
                const result = await api.request('/candidate-games');
                if (destroyed || current !== generation) return;
                state.games = result.games;
            }
            if (!keepError) state.error = '';
        } catch (error) {
            if (destroyed || current !== generation) return;
            state.error = error.message;
            if ([401, 403, 404].includes(error.status)) { state.data = null; state.date = null; }
            if (error.status === 404) { state.gameId = ''; state.games = []; }
        } finally {
            if (!destroyed && current === generation) { state.loading = false; render(); schedule(); }
        }
    }
    async function selectGame(id) {
        if (state.busy || state.layoutMode !== 0) return;
        generation++; state.gameId = String(id); state.data = null; state.date = null; state.error = ''; state.message = '';
        await refresh();
    }
    async function changeMonth(offset) {
        if (state.busy || state.layoutMode !== 0 || offset === state.offset) return;
        generation++; state.offset = offset; state.data = null; state.date = null; state.error = ''; state.message = '';
        await refresh();
    }
    function selectDate(date) {
        if (state.busy || state.layoutMode !== 0 || !state.data?.candidates.some(slot => slot.localDate === date)) return;
        state.date = date; state.message = ''; render();
    }
    function close() {
        if (state.busy) return;
        const date = state.date; state.date = null; render();
        [...root.querySelectorAll('[data-date]')].find(node => node.dataset.date === date)?.focus();
    }
    async function recruit(slotId) {
        const slot = state.data?.candidates.find(candidate => candidate.slotId === slotId && candidate.localDate === state.date);
        if (destroyed || state.busy || state.loading || state.error || state.layoutMode !== 0 || !slot || slot.recruitment) return;
        const body = { monthId: state.data.month.id, gameId: state.data.game.id, slotId };
        state.busy = true; state.error = ''; state.message = ''; clearTimeout(timer); render();
        let failure;
        try {
            await api.request('/recruitments', { method: 'POST', body });
            state.message = 'ゲームチャンネルへ募集メッセージを送信しました。';
        } catch (error) {
            failure = error;
            state.error = `${error.message} 募集状態を確認してください。`;
        }
        if (!destroyed) {
            await refresh({ keepError: Boolean(failure) });
            state.busy = false; render(); schedule();
        }
    }
    const actions = { refresh: () => { if (!state.busy) return refresh(); }, selectGame, changeMonth, selectDate, close, recruit };
    function onVisibility() { clearTimeout(timer); if (canPoll() && !state.busy) void refresh(); }
    function onKey(event) {
        if (event.key === 'Escape') { close(); return; }
        const dialog = root.querySelector('[role=dialog]');
        if (dialog && event.key === 'Tab') {
            const buttons = [...dialog.querySelectorAll('button:not(:disabled)')];
            if (!buttons.length) { event.preventDefault(); return; }
            if (event.shiftKey && (document.activeElement === buttons[0] || document.activeElement === dialog)) { event.preventDefault(); buttons.at(-1).focus(); }
            else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0].focus(); }
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
        start: async () => { started = true; await refresh(); }, ...actions,
        setLayoutMode(mode) { const changed = state.layoutMode !== mode; state.layoutMode = mode; render(); clearTimeout(timer); if (changed && canPoll() && !state.busy) void refresh(); },
        destroy() { destroyed = true; generation++; clearTimeout(timer); root.removeEventListener('keydown', onKey); document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('focus', onVisibility); }
    };
}

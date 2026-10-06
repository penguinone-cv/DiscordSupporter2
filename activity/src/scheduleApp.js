import { selectedRange } from './calendarModel.js';
import { renderSchedule } from './view.js';

export function createScheduleApp(root, { api, pollMs = 5000, onBusy = () => {} } = {}) {
    const state = { data: null, offset: 0, day: null, selectedDate: null, rangeStart: null, range: null, rangeMode: null, preview: null, draft: {}, bulkStatus: null, discard: false, busy: false, error: '', message: '', layoutMode: -1 };
    let timer, inFlight, destroyed = false, started = false, generation = 0;
    const render = () => { if (!destroyed) { onBusy(state.busy || Boolean(state.day || state.preview)); renderSchedule(root, state, actions); } };
    const canPoll = () => started && !destroyed && !document.hidden && state.layoutMode === 0 && !state.preview;
    function clearRange() {
        state.rangeStart = null; state.range = null; state.rangeMode = null; state.preview = null;
        state.draft = {}; state.bulkStatus = null; state.discard = false;
    }
    const changes = () => state.rangeMode === 'bulk'
        ? state.bulkStatus && state.preview ? state.preview.slots.map(slot => ({ slotId: slot.id, status: state.bulkStatus })) : []
        : Object.entries(state.draft).map(([slotId, status]) => ({ slotId: Number(slotId), status }));
    const schedule = () => {
        clearTimeout(timer);
        if (canPoll()) timer = setTimeout(() => { if (!state.busy) void refresh(); else schedule(); }, pollMs);
    };
    async function refresh(force = false) {
        if (destroyed) return;
        if ((state.busy || state.preview) && !force) return;
        if (inFlight) return inFlight;
        const current = generation;
        inFlight = (async () => {
            try {
                const data = await api.request(`/month?offset=${state.offset}`);
                if (destroyed || current !== generation) return;
                if (state.data && state.data.month.id !== data.month.id) {
                    state.selectedDate = null; state.day = null; clearRange();
                }
                const selectedDate = state.selectedDate;
                let day = null;
                if (selectedDate && !state.preview) day = await api.request(`/months/${data.month.id}/days/${selectedDate}`);
                if (destroyed || current !== generation) return;
                state.data = data;
                if (selectedDate === state.selectedDate) state.day = day;
                state.error = '';
            } catch (error) {
                if (destroyed || current !== generation) return;
                state.error = error.message;
                if ([401, 403].includes(error.status)) { state.data = null; state.day = null; clearRange(); }
            } finally { inFlight = null; render(); schedule(); }
        })();
        return inFlight;
    }
    async function operation(fn, message) {
        if (state.busy || state.layoutMode !== 0) return;
        state.busy = true; state.error = ''; render();
        try { if (inFlight) await inFlight; await fn(); state.message = message; }
        catch (error) {
            state.error = error.status === 409 ? '別の端末で予定が変わりました。更新して範囲を選び直し、再確認してください。' : error.message;
            if (error.status === 409 || [401, 403].includes(error.status)) clearRange();
            if ([401, 403].includes(error.status)) { state.data = null; state.day = null; }
        }
        finally { state.busy = false; render(); schedule(); }
    }
    async function selectDate(date) {
        if (!state.data || state.busy || state.preview || state.layoutMode !== 0) return;
        const { year, month } = state.data.month;
        selectedRange(date, date, year, month);
        if (state.rangeStart !== null) {
            if (!state.rangeStart) { state.rangeStart = date; render(); return; }
            state.range = selectedRange(state.rangeStart, date, year, month);
            await operation(async () => {
                const path = state.rangeMode === 'reset' ? '/range-reset/preview' : '/range-edit/preview';
                state.preview = await api.request(path, { method: 'POST', body: { monthId: state.data.month.id, ...state.range } });
            }, '対象範囲を確認してください');
        } else {
            state.selectedDate = date;
            await operation(async () => { state.day = await api.request(`/months/${state.data.month.id}/days/${date}`); }, '');
        }
    }
    const actions = {
        refresh: () => refresh(),
        selectDate,
        changeMonth: async offset => {
            if (state.busy || state.preview || offset === state.offset) return;
            state.busy = true; render();
            if (inFlight) await inFlight;
            generation++; state.offset = offset; state.day = null; state.selectedDate = null; clearRange();
            state.data = null;
            await refresh(true);
            state.busy = false; render(); schedule();
        },
        beginRange: (mode = 'reset') => {
            if (state.busy || state.preview || state.error) return;
            const cancel = state.rangeMode === mode;
            clearRange();
            if (!cancel) { state.rangeMode = mode; state.rangeStart = ''; }
            state.day = null; state.selectedDate = null; state.message = ''; render();
        },
        close: () => {
            if (state.busy) return;
            if (state.preview && changes().length) { state.discard = true; render(); return; }
            actions.discard();
        },
        discard: () => {
            if (state.busy) return;
            const focusDate = state.selectedDate || state.rangeStart;
            state.day = null; state.selectedDate = null; clearRange(); state.message = ''; render(); schedule();
            [...root.querySelectorAll('[data-date]')].find(node => node.dataset.date === focusDate)?.focus();
        },
        continueEditing: () => { state.discard = false; render(); },
        stage: (slotId, status) => {
            if (state.busy || state.layoutMode !== 0 || state.rangeMode !== 'continuous' || !state.preview) return;
            const slot = state.preview.slots.find(item => item.id === slotId);
            if (!slot) return;
            if (slot.status === status) delete state.draft[slotId];
            else state.draft[slotId] = status;
            render();
        },
        setBulkStatus: status => {
            if (state.busy || state.layoutMode !== 0 || state.rangeMode !== 'bulk' || !state.preview) return;
            state.bulkStatus = status; render();
        },
        save: (slotId, status) => operation(async () => {
            if (inFlight) await inFlight;
            await api.request(`/months/${state.data.month.id}/slots/${slotId}`, { method: 'PUT', body: { status } });
            await refresh(true);
        }, '保存済み'),
        confirmReset: () => operation(async () => {
            if (!state.preview || state.error) return;
            const { monthId, startDate, endDate, revision } = state.preview;
            await api.request('/range-reset', { method: 'POST', body: { monthId, startDate, endDate, revision } });
            clearRange();
            await refresh(true);
        }, '選択範囲を基本予定に戻しました'),
        confirmChanges: () => operation(async () => {
            if (!state.preview || !changes().length) return;
            const { monthId, startDate, endDate, revision } = state.preview;
            await api.request('/range-edit', { method: 'POST', body: { monthId, startDate, endDate, revision, changes: changes() } });
            clearRange();
            await refresh(true);
        }, '選択範囲の変更を保存しました')
    };
    function onVisibility() { clearTimeout(timer); if (canPoll()) void refresh(); }
    function onKey(event) {
        if (event.key === 'Escape') { actions.close(); return; }
        const dialog = root.querySelector('[role=dialog]');
        if (dialog && event.key === 'Tab') {
            const targets = [...dialog.querySelectorAll('button:not(:disabled)')];
            if (!targets.length) { event.preventDefault(); return; }
            if (event.shiftKey && document.activeElement === targets[0]) { event.preventDefault(); targets.at(-1).focus(); }
            else if (!event.shiftKey && document.activeElement === targets.at(-1)) { event.preventDefault(); targets[0].focus(); }
        }
        const shifts = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
        if (!dialog && event.target.dataset.date && shifts[event.key]) {
            const targets = [...root.querySelectorAll('[data-date]')];
            const index = targets.indexOf(event.target) + shifts[event.key];
            if (targets[index]) { event.preventDefault(); targets[index].focus(); }
        }
    }
    root.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onVisibility);
    return {
        start: async () => { started = true; render(); await refresh(); },
        refresh: () => refresh(), selectDate,
        setLayoutMode: mode => { const changed = state.layoutMode !== mode; state.layoutMode = mode; render(); clearTimeout(timer); if (changed && canPoll()) void refresh(); },
        destroy: () => { destroyed = true; generation++; clearTimeout(timer); root.removeEventListener('keydown', onKey); document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('focus', onVisibility); }
    };
}

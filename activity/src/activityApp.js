import { createScheduleApp } from './scheduleApp.js';
import { createCandidateApp } from './candidateApp.js';
import { createConfirmedApp } from './confirmedApp.js';
import { element } from './view.js';

export function createActivityApp(root, { api, scheduleFactory = createScheduleApp, candidateFactory = createCandidateApp, confirmedFactory = createConfirmedApp } = {}) {
    let app, current = 'schedule', mode = -1, locked = false, destroyed = false, switching = false;
    const content = element('div');
    const factories = { schedule: scheduleFactory, candidates: candidateFactory, confirmed: confirmedFactory };
    const buttons = ['schedule', 'candidates', 'confirmed'].map((tab, index) => element('button', {
        type: 'button', 'data-tab': tab, 'aria-pressed': String(index === 0),
        onClick: () => { if (!locked && !switching && tab !== current) void mount(tab); }
    }, ['予定入力', '候補日確認', '確定済み予定'][index]));
    const navigation = element('nav', { className: 'activity-tabs', 'aria-label': '予定の機能' }, buttons);
    function sync() {
        navigation.hidden = mode !== 0;
        buttons.forEach(button => {
            button.disabled = locked || switching;
            button.setAttribute('aria-pressed', String(button.dataset.tab === current));
        });
    }
    async function mount(tab) {
        if (destroyed) return;
        switching = true; app?.destroy(); current = tab; locked = false; sync();
        app = factories[tab](content, { api, onBusy: busy => { locked = busy; sync(); } });
        app.setLayoutMode(mode);
        try { await app.start(); }
        finally { switching = false; sync(); }
    }
    return {
        async start() { root.replaceChildren(navigation, content); await mount('schedule'); },
        setLayoutMode(value) { mode = value; sync(); app?.setLayoutMode(value); },
        destroy() { destroyed = true; app?.destroy(); }
    };
}

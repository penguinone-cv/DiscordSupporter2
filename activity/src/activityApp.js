import { createScheduleApp } from './scheduleApp.js';
import { createCandidateApp } from './candidateApp.js';
import { element } from './view.js';

export function createActivityApp(root, { api, scheduleFactory = createScheduleApp, candidateFactory = createCandidateApp } = {}) {
    let app, current = 'schedule', mode = -1, locked = false, destroyed = false, switching = false;
    const content = element('div');
    const buttons = ['schedule', 'candidates'].map((tab, index) => element('button', {
        type: 'button', 'data-tab': tab, 'aria-pressed': String(index === 0),
        onClick: () => { if (!locked && !switching && tab !== current) void mount(tab); }
    }, index === 0 ? '予定入力' : '候補日確認'));
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
        app = (tab === 'schedule' ? scheduleFactory : candidateFactory)(content, { api, onBusy: busy => { locked = busy; sync(); } });
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

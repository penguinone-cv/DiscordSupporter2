import { DiscordSDK } from '@discord/embedded-app-sdk';
import { createApi } from './api.js';
import { connectActivity } from './activityClient.js';
import { createScheduleApp } from './scheduleApp.js';
import { showNotice } from './view.js';
import './styles.css';

const root = document.getElementById('app');
let app, connection;
async function start() {
    app?.destroy();
    await connection?.disconnect?.().catch(() => {});
    if (window.self === window.top) {
        showNotice(root, 'Discordから起動してください。サーバーのメンバーパネルにある「月間予定を編集」から開けます。');
        return;
    }
    showNotice(root, 'Discordに接続しています…');
    const api = createApi();
    app = createScheduleApp(root, { api });
    try {
        connection = await connectActivity({ api, sdkFactory: id => new DiscordSDK(id), onLayout: mode => app.setLayoutMode(mode) });
        await app.start();
    } catch (error) {
        app.destroy();
        showNotice(root, error.message, start);
    }
}
window.addEventListener('pagehide', () => { app?.destroy(); void connection?.disconnect?.().catch(() => {}); });
void start();

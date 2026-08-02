import channelActivityService from './channelActivityService.js';
import gameRegistryService from './gameRegistryService.js';
import gameAdminPanelService from './gameAdminPanelService.js';
import gameMemberPanelService from './gameMemberPanelService.js';
import gameReturnRequestService from './gameReturnRequestService.js';
import scheduleService from './scheduleService.js';
import logger from '../utils/logger.js';

const DAILY_INTERVAL = 24 * 60 * 60 * 1000;

class MaintenanceService {
    constructor() {
        this.timer = null;
        this.running = false;
    }

    start(client) {
        if (this.timer) return;
        this.timer = setInterval(() => {
            this.run(client).catch(error => logger.error('定期整合処理エラー:', error));
        }, DAILY_INTERVAL);
        this.timer.unref?.();
    }

    async run(client) {
        if (this.running) return;
        this.running = true;
        try {
            await gameRegistryService.reconcileAll(client);
            await channelActivityService.reconcileAll(client);
            for (const guild of client.guilds.cache.values()) {
                scheduleService.ensureCurrentAndNext(guild.id);
                await gameAdminPanelService.refreshPanel(guild);
                await gameMemberPanelService.refreshPanel(guild);
                await gameReturnRequestService.reconcileGuild(guild);
            }
        } finally {
            this.running = false;
        }
    }

    stop() {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }
}

export default new MaintenanceService();

import gameRegistryService from '../services/gameRegistryService.js';
import logger from '../utils/logger.js';

export default async function handleChannelUpdate(_oldChannel, newChannel) {
    try {
        gameRegistryService.handleChannelUpdate(newChannel);
    } catch (error) {
        logger.error('チャンネル更新の同期エラー:', error);
    }
}


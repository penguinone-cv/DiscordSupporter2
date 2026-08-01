import gameRegistryService from '../services/gameRegistryService.js';
import logger from '../utils/logger.js';

export default async function handleChannelDelete(channel) {
    try {
        gameRegistryService.handleChannelDelete(channel);
    } catch (error) {
        logger.error('チャンネル削除の同期エラー:', error);
    }
}

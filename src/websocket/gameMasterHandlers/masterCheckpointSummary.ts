import checkpointMethods from '../helpers/CheckpointMethods';
import CrossServer from '../helpers/CrossServer';
import sendDiscordPrompter from '../helpers/sendDiscordPrompter';
import DiscordPrompt from '../wsTypes/DiscordPrompt';
import WsGameInfo from '../wsTypes/WsGameInfo';
import redis from '../../common/redisClient';
import rGameKey from '../wsTypes/redisGameKeys';
import sendProducerCheckpointStatus from '../helpers/sendProducerCheckpointStatus';
import logger from '../../common/logger';

async function masterCheckpointSummaryHandler(gameInfo: WsGameInfo) {
    const { broadcastId } = gameInfo;
    const { currentId: checkpointId } = await checkpointMethods(broadcastId).getIds();
    
    if (checkpointId) {
        await redis.hSet(rGameKey(broadcastId).checkpoint(checkpointId).cp, 'summarySent', Date.now().toString());
        sendProducerCheckpointStatus(broadcastId, checkpointId).catch(err => logger.error('Failed to send producer checkpoint status', err));
        
        setTimeout(() => {
            sendProducerCheckpointStatus(broadcastId, checkpointId).catch(err => logger.error('Failed to send producer checkpoint status (complete)', err));
        }, 10000);
    }
    
	await CrossServer.sendAllServers('checkpointSummary', broadcastId);
	// Commented out for trivia games (except game start/end)
	// sendDiscordPrompter([
	// 	new DiscordPrompt(gameInfo, 'now').checkpointSummary(checkpointId!)
	// ]);
}

export default masterCheckpointSummaryHandler;

import HqError from '../../common/hqError';
import redis from '../../common/redisClient';
import rGameKey from '../wsTypes/redisGameKeys';
import WsGameInfo from '../wsTypes/WsGameInfo';
import CrossServer from '../helpers/CrossServer';
import sendProducerWheelStatus from '../helpers/sendProducerWheelStatus';
import logger from '../../common/logger';

async function masterWheelHandler(gameInfo: WsGameInfo, broadcastId: number) {
    const letters = gameInfo.wheelLetters;
    if (!letters) {
        throw new HqError('No wheel letters were selected for this show.', 0, 400);
    }
    const wheelStartTime = Date.now();
    await redis.hSet(rGameKey(broadcastId).gameInfo, {
        'wheelRevealed': 1,
        'wheelStartTime': wheelStartTime.toString()
    });

    await CrossServer.sendAllServers('wheel', broadcastId);
    
    sendProducerWheelStatus(broadcastId).catch(err => logger.error('Failed to send producer wheel status', err));
    
    setTimeout(() => {
        sendProducerWheelStatus(broadcastId).catch(err => logger.error('Failed to send producer wheel status after completion', err));
    }, 18000);
    
    return { letters: letters, superWheelItems: gameInfo.superWheelItems };
}

export default masterWheelHandler;

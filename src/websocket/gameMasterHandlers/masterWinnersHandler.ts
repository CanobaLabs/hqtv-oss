import redis from '../../common/redisClient';
import generateWinners from '../helpers/generateWinners';
import rGameKey from '../wsTypes/redisGameKeys';
import WinInfo from '../redisSchemas/winInfo';
import WsGameInfo from '../wsTypes/WsGameInfo';
import CrossServer from '../helpers/CrossServer';
import sendProducerWinners from '../helpers/sendProducerWinners';
import sendProducerWinnersStatus from '../helpers/sendProducerWinnersStatus';
import logger from '../../common/logger';

async function masterWinnersHandler(gameInfo: WsGameInfo, broadcastId: number) {
    const existWinnersStr = await redis.get(rGameKey(broadcastId).winners);
    let winners: WinInfo[];
    if (!existWinnersStr) {
        winners = await generateWinners(+broadcastId);
    } else {
        winners = JSON.parse(existWinnersStr!) as WinInfo[];
    }
    
    if (gameInfo.gameType === 'trivia') {
        await redis.set(rGameKey(broadcastId).currentState, 'gameSummary');
    } else if (gameInfo.gameType === 'words') {
        await redis.set(rGameKey(broadcastId).currentState, 'wordsGameResult');
    }
    await CrossServer.sendAllServers('winners', broadcastId);
    sendProducerWinners(broadcastId, winners).catch(err => logger.error('Failed to send producer winners', err));
    sendProducerWinnersStatus(broadcastId).catch(err => logger.error('Failed to send producer winners status', err));
    return winners;
}

export default masterWinnersHandler;

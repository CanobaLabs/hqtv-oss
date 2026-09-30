import redis from '../../common/redisClient';
import getGameInfo from './getGameInfo';
import rGameKey from '../wsTypes/redisGameKeys';

type WinnersStatus = 'notStarted' | 'visible' | 'complete';

async function getWinnersStatus(broadcastId: number): Promise<WinnersStatus> {
    const winnersStr = await redis.get(rGameKey(broadcastId).winners);
    
    if (!winnersStr) {
        return 'notStarted';
    }
    
    const gameInfo = await getGameInfo(broadcastId);
    const currentState = await redis.get(rGameKey(broadcastId).currentState);
    
    if (currentState === 'gameSummary' || currentState === 'wordsGameResult') {
        return 'visible';
    }
    
    return 'complete';
}

export default getWinnersStatus;
export type { WinnersStatus };


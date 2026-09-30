import redis from '../../common/redisClient';
import rGameKey from '../wsTypes/redisGameKeys';

type WheelStatus = 'notStarted' | 'visible' | 'complete';

async function getWheelStatus(broadcastId: number): Promise<WheelStatus> {
    const gameInfo = await redis.hGetAll(rGameKey(broadcastId).gameInfo);
    const wheelRevealed = gameInfo.wheelRevealed === '1';
    const wheelStartTime = gameInfo.wheelStartTime;
    
    if (!wheelRevealed || !wheelStartTime) {
        return 'notStarted';
    }
    
    const startTime = +wheelStartTime;
    const elapsedMs = Date.now() - startTime;
    const WHEEL_DURATION_MS = 18000;
    
    if (elapsedMs < WHEEL_DURATION_MS) {
        return 'visible';
    }
    
    return 'complete';
}

export default getWheelStatus;
export type { WheelStatus };


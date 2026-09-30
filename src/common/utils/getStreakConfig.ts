import logger from '../../common/logger';
import redis from '../../common/redisClient';
import rKey from '../../common/redisKeys';
import StreakConfig from '../database/configModels/streakConfig';

type StreakConfigInstance = {
    streaksEnabled: number;
    streakTarget: number;
    streakWaitSec: number;
    absenseEndsStreak: number;
    streakExpirySec: number | null;
}

const streakConfigDefault: StreakConfigInstance = {
    streaksEnabled: 0,
    streakTarget: 0,
    streakWaitSec: 0,
    absenseEndsStreak: 0,
    streakExpirySec: 0
}

async function getStreakConfig(): Promise<StreakConfigInstance> {
    const cache = await redis.hGetAll(rKey.streakConfig);
    if (Object.keys(cache).length == 0) {
        // config not cached
        logger.info('updating streak config in redis');
        const streakConfig = await StreakConfig.findOne({ order: [['versionId', 'DESC']] });
        if (streakConfig) {
            const parsed = Object.entries(streakConfig).flatMap(([k, v]) => v != null ? [k, v.toString()] : []);
            await redis.hSet(rKey.streakConfig, parsed);
            return streakConfig;
        } else {
            logger.error('streak config missing');
        }
    }
    return {
        streaksEnabled: +(cache.streaksEnabled ?? streakConfigDefault.streaksEnabled),
        streakTarget: +(cache.streakTarget ?? streakConfigDefault.streakTarget),
        streakWaitSec: +(cache.streakWaitSec ?? streakConfigDefault.streakWaitSec),
        absenseEndsStreak: +(cache.absenseEndsStreak ?? streakConfigDefault.absenseEndsStreak),
        streakExpirySec: +(cache.streakExpirySec ?? streakConfigDefault.streakExpirySec)
    }
}

export default getStreakConfig;

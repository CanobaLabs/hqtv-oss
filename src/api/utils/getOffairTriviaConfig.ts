import OffairTriviaConfig from '../../common/database/configModels/offairTriviaConfig';
import logger from '../../common/logger';
import redis from '../../common/redisClient';
import rKey from '../../common/redisKeys';

type OffairTriviaInstance = {
    enabled: number;
    questionCount: number;
    correctCoins: number;
    correctPoints: number;
    completionCoins: number;
    nextGameWaitSec: number;
    nextGameWaitSecBooster: number;
}

const offairDefault: OffairTriviaInstance = {
    enabled: 0,
    questionCount: 0,
    correctCoins: 0,
    correctPoints: 0,
    completionCoins: 0,
    nextGameWaitSec: 0,
    nextGameWaitSecBooster: 0
}

async function getOffairTriviaConfig(): Promise<OffairTriviaInstance> {
    const cache = await redis.hGetAll(rKey.offairTriviaConfig);
    if (Object.keys(cache).length == 0) {
        // config not cached
        logger.info('updating offair config in redis');
        const offairTriviaConfig = await OffairTriviaConfig.findOne({ order: [['versionId', 'DESC']] });
        if (offairTriviaConfig) {
            const parsed = Object.entries(offairTriviaConfig).flatMap(([k, v]) => [k, v.toString()])
            await redis.hSet(rKey.offairTriviaConfig, parsed);
            return offairTriviaConfig;
        } else {
            logger.error('offair config missing');
        }
    }
    return {
        enabled: +(cache.enabled ?? offairDefault.enabled),
        questionCount: +(cache.questionCount ?? offairDefault.questionCount),
        correctCoins: +(cache.correctCoins ?? offairDefault.correctCoins),
        correctPoints: +(cache.correctPoints ?? offairDefault.correctPoints),
        completionCoins: +(cache.completionCoins ?? offairDefault.completionCoins),
        nextGameWaitSec: +(cache.nextGameWaitSec ?? offairDefault.nextGameWaitSec),
        nextGameWaitSecBooster: +(cache.nextGameWaitSecBooster ?? offairDefault.nextGameWaitSecBooster)
    }
}

export default getOffairTriviaConfig;

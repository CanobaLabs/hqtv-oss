import KeepPlayingConfig from '../../common/database/configModels/keepPlayingConfig';
import logger from '../../common/logger';
import redis from '../../common/redisClient';
import rKey from '../../common/redisKeys';

type KpConfig = {
    enabled: number;
    baseCoins: number;
    coinsPerRightAnswer: number;
    eraserChance: number;
    lifeChance: number;
    maxLives: number;
    maxErasers: number;
    consecutiveChanceMulti: number;
}

const kpDefault: KpConfig = {
    enabled: 0,
    baseCoins: 0,
    coinsPerRightAnswer: 0,
    eraserChance: 0,
    lifeChance: 0,
    maxLives: 0,
    maxErasers: 0,
    consecutiveChanceMulti: 0
}

async function getKeepPlayingConfig(): Promise<KpConfig> {
    const cache = await redis.hGetAll(rKey.keepPlayingConfig);
    if (Object.keys(cache).length == 0) {
        // config not cached
        logger.info('updating kp config in redis');
        const kpConfig = await KeepPlayingConfig.findOne({ where: { enabled: true }, order: [['versionId', 'DESC']] });
        if (kpConfig) {
            const parsed = Object.entries(kpConfig).flatMap(([k, v]) => [k, v.toString()])
            await redis.hSet(rKey.keepPlayingConfig, parsed);
            return kpConfig;
        } else {
            logger.error('kp config missing');
        }
    }
    return {
        enabled: +(cache.enabled ?? kpDefault.enabled),
        baseCoins: +(cache.baseCoins ?? kpDefault.baseCoins),
        coinsPerRightAnswer: +(cache.coinsPerRightAnswer ?? kpDefault.coinsPerRightAnswer),
        eraserChance: +(cache.eraserChance ?? kpDefault.eraserChance),
        lifeChance: +(cache.lifeChance ?? kpDefault.lifeChance),
        maxLives: +(cache.maxLives ?? kpDefault.maxLives),
        maxErasers: +(cache.maxErasers ?? kpDefault.maxErasers),
        consecutiveChanceMulti: +(cache.consecutiveChanceMulti ?? kpDefault.consecutiveChanceMulti)
    }
}

export default getKeepPlayingConfig;

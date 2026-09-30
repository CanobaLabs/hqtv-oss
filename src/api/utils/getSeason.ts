import redis from '../../common/redisClient';
import rKey from '../../common/redisKeys';
import LevelInfo from '../../common/types/level';
import ParsedSeasonConfig from '../../common/types/parsedSeasonConfig';
import RedisSeasonConfig from '../../common/types/redisSeasonConfig';

export default async function getSeason() {
	const [seasonConfig, levels] = await Promise.all([
        redis.hGetAll(rKey.seasonConfig) as Promise<RedisSeasonConfig>,
        getLevels()
    ]);
	const isCached = Object.values(seasonConfig).length > 0;
	if (isCached) {
		return {
            seasonId: seasonConfig.seasonId,
            seasonName: seasonConfig.seasonName,
            startDate: new Date(seasonConfig.startDate),
            endDate: new Date(seasonConfig.endDate),
            tentpoleEnabled: !!+seasonConfig.tentpoleEnabled,
            tentpoleEnabled_android: seasonConfig.tentpoleEnabled_android,
            finalePrizeCents: +seasonConfig.finalePrizeCents,
            howItWorks: seasonConfig.howItWorks,
            disclaimer: seasonConfig.disclaimer,
            levels: levels
        } as ParsedSeasonConfig;
	} else {
        return null;
    }
}

async function getLevels(): Promise<LevelInfo[]> {
    const levels = await redis.json.get(rKey.seasonLevels) as LevelInfo[];
    if (levels) {
        return levels;
    } else {
        return [];
    }
}

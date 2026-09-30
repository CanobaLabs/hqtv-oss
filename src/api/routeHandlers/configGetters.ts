import redis from '../../common/redisClient';
import rKey from '../../common/redisKeys';
import getSeason from '../utils/getSeason';

export async function getPublicConfig() {
	const data = await redis.get(rKey.publicConfig);
    if (data) {
        return JSON.parse(data);
    } else {
        return null;
    }
}

export async function getMainConfig() {
	const data = await redis.get(rKey.mainConfig);
    if (data) {
        const season = await getSeason();
        return {
            ...JSON.parse(data),
            seasonXp: !!season,
            season: season?.seasonId
        }
    } else {
        return null;
    }
}

export async function getAdminConfig(isAdmin: boolean, isTester: boolean) {
	if (isAdmin || isTester) {
        return {
            segments: [],
            showTypes: ['All Shows', 'Public Shows', 'Rehearsal Shows']
        }
    } else {
        return {
            segments: [],
            showTypes: ['Public Shows']
        }
    }
}

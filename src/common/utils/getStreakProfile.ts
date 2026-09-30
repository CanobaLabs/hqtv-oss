import redis from '../redisClient';
import rKey from '../redisKeys';
import getStreakConfig from './getStreakConfig';

type RedisStreakProfile = {
    target: string;
    current: string;
    startDate: string;
    lastPlayed: string;
}

type ParsedStreakProfile = {
    target: number;
    current: number;
    startDate: Date;
    lastPlayed: Date;
    completed: boolean;
}

export const parseStreakProfile = (r: RedisStreakProfile, defaultTarget?: number): ParsedStreakProfile => {
	const now = Date.now();
    const target = +(r.target ?? defaultTarget ?? 5);
    const current = +(r.current ?? 0);
    return {
        target: target,
        current: current,
        startDate: new Date(r.startDate ?? now),
        lastPlayed: new Date(r.lastPlayed ?? now),
        completed: current >= target
    }
}

export const getStreakProfile = async (userId: number | string): Promise<ParsedStreakProfile> => {
    const [streakGlobals, existingStreak] = await Promise.all([
        getStreakConfig(),
        redis.hGetAll(rKey.streakInProgress(userId)) as Promise<RedisStreakProfile>
    ]);
    return parseStreakProfile(existingStreak, streakGlobals.streakTarget);
}

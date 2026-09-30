import ms from 'ms';
import redis from '../../common/redisClient';
import rKey from '../../common/redisKeys';
import getStreakConfig from '../../common/utils/getStreakConfig';
import { getStreakProfile } from '../../common/utils/getStreakProfile';
import rGameKey from '../wsTypes/redisGameKeys';
import HqWebSocket from '../wsTypes/HqWebSocket';

async function advanceStreak(broadcastId: number, playerId: string, joinTime: number) {
    const [streakGlobals, plrStreak] = await Promise.all([
        getStreakConfig(),
        getStreakProfile(playerId)
    ]);
    const { streaksEnabled, streakTarget, streakExpirySec, streakWaitSec } = streakGlobals;
    if (!streaksEnabled) return;

    if (plrStreak.current == 0 || plrStreak.completed) {
        // start streak
        const streak = Object.entries({
            target: streakTarget.toString(),
            current: '1',
            startDate: new Date(joinTime).toISOString(),
            lastPlayed: new Date(joinTime).toISOString()
        });
        const multi = redis.multi()
            .del(rKey.streakInProgress(playerId)) // clear cache from previous streak (if one existed)
            .hSet(rKey.streakInProgress(playerId), streak)
        if (streakExpirySec) {
            multi.expire(rKey.streakInProgress(playerId), streakExpirySec);
        }
        multi.sAdd(rGameKey(broadcastId).streaksAdvanced, playerId);
        multi.exec();
        return { target: streakTarget, current: 1 };
    } else {
        const lastPlayedTime = new Date(plrStreak.lastPlayed).getTime();
        const streakCooldownExpiry = lastPlayedTime + ms(`${streakWaitSec} seconds`);
        if (joinTime < streakCooldownExpiry) {
            return; // too soon
        }

        const newCurrent = plrStreak.current + 1;
        const multi = redis.multi()
            .hSet(rKey.streakInProgress(playerId), [
                'current', newCurrent,
                'lastPlayed', new Date(joinTime).toISOString()
            ]);
        if (newCurrent >= plrStreak.target) {
            // completed streak
            multi.hIncrBy(rGameKey(broadcastId).livesEarned, playerId, 1); // can be used in current game
        }
        multi.sAdd(rGameKey(broadcastId).streaksAdvanced, playerId);
        multi.exec();
        return { target: plrStreak.target, current: newCurrent };
    }
}

export default advanceStreak;

import ms from 'ms';
import redis from '../../common/redisClient';
import { getPuzzle } from './gameDataGetters';
import rGameKey from '../wsTypes/redisGameKeys';
import getGameInfo from './getGameInfo';
import { bulkGetUsers } from '../../common/utils/userGetters';
import getGeneralConfig from '../../api/utils/getGeneralConfig';

async function updateBroadcastStats(broadcastId: number) {
    const gameInfo = await getGameInfo(broadcastId);
    const config = await getGeneralConfig();

    const timeNow = Date.now();
    const AUDIT_FREQUENCY_SEC = 25;
    const [viewersAuditDue, viewersRefreshDue] = await Promise.all([
        redis.set(rGameKey(broadcastId).lastViewersAudit, timeNow, { EX: AUDIT_FREQUENCY_SEC, NX: true }),
        redis.set(rGameKey(broadcastId).lastViewersRefresh, timeNow, { PX: config.broadcastStatsRefreshIntervalMs, NX: true })
    ]);
    if (viewersAuditDue) {
        // clear viewers that haven't pinged recently - dead clients
        // this will also affect 'watching' viewers as it branches off `connected`
        const clearBefore = timeNow - ms(`${config.broadcastStatsClearBeforeSec} seconds`);
        await redis.zRemRangeByScore(rGameKey(broadcastId).connected, 0, clearBefore);
    }
    if (viewersRefreshDue) {
        // drawer viewers
        const [playingPlrIds, watchingPlrIds] = await Promise.all([
            redis.sMembers(rGameKey(broadcastId).inTheGame), // includes players that aren't connected
            redis.zDiff([rGameKey(broadcastId).connected, rGameKey(broadcastId).inTheGame]) // anyone who is connected but not playing
        ]) 
        const playingWatchingUserIds = [...playingPlrIds, ...watchingPlrIds].map(plrId => +plrId);
        const [playingUsers, playingWatchingUsers] = await Promise.all([
            bulkGetUsers(playingPlrIds.map(plrId => +plrId)),
            bulkGetUsers(playingWatchingUserIds)
        ]);
        const vipUserIds = playingWatchingUsers.flatMap(usr => {
            if (usr.booster) {
                return usr.id;
            } else return [];
        });
        const inVipsIds = playingUsers.flatMap(usr => {
            if (usr.booster) {
                return usr.id;
            } else return [];
        });
        const multi = redis.multi()
            .del(rGameKey(broadcastId).playingViewers)
            .del(rGameKey(broadcastId).watchingViewers)
            .del(rGameKey(broadcastId).viewers('pro'))
            .del(rGameKey(broadcastId).viewers('pro'))
        if (playingPlrIds.length > 0) {
            multi.zAdd(rGameKey(broadcastId).playingViewers, playingPlrIds.map(plrId => ({ value: plrId, score: 1 })));
        }
        if (watchingPlrIds.length > 0) {
            multi.zAdd(rGameKey(broadcastId).watchingViewers, watchingPlrIds.map(plrId => ({ value: plrId, score: 1 })));
        }
        if (vipUserIds.length > 0) {
            multi.zAdd(rGameKey(broadcastId).viewers('pro'), vipUserIds.map(usrId => ({ value: usrId.toString(), score: 1 })));
        }
        await multi.exec();

        // viewer counts
        const [connectedCount, playingCount, watchingCount] = await Promise.all([
            redis.zCard(rGameKey(broadcastId).connected),
            redis.zCard(rGameKey(broadcastId).playingViewers),
            redis.zCard(rGameKey(broadcastId).watchingViewers)
        ]);
        await redis.hSet(rGameKey(broadcastId).viewerCounts, [
            'connected', connectedCount,
            'playing', playingCount,
            'watching', watchingCount,
            'vipPlaying', inVipsIds.length
        ]);
    }
    
    const { gameType } = gameInfo;
    const activePuzzle = await getPuzzle(broadcastId);
    if (gameType === 'words' && activePuzzle) {
        // round stats
        const [solvingCount, completedCount, strikedOutCount] = await Promise.all([
            redis.sCard(rGameKey(broadcastId).solvingPlayers),
            redis.sCard(rGameKey(broadcastId).inTheGame),
            redis.sCard(rGameKey(broadcastId).question(+gameInfo.questionNumber).strikedOut)
        ]);
        await redis.hSet(rGameKey(broadcastId).roundStats, [
            'roundId', activePuzzle.id,
            'roundPlaying', solvingCount,
            'roundCompleted', completedCount,
            'roundEliminated', strikedOutCount
        ]);
    }
}

export default updateBroadcastStats;

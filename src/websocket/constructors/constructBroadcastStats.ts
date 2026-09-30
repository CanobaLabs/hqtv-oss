import redis from '../../common/redisClient';
import rGameKey from '../wsTypes/redisGameKeys';
import HqBroadcastStats from '../wsMessageTypes/HqBroadcastStats';

async function constructBroadcastStats(broadcastId: number, userId?: number) {
    const [viewerCounts, roundStats] = await redis.multi()
        .hmGet(rGameKey(broadcastId).viewerCounts, ['connected', 'playing', 'watching', 'vipPlaying'])
        .hmGet(rGameKey(broadcastId).roundStats, ['roundId', 'roundPlaying', 'roundCompleted', 'roundEliminated'])
        .exec() as [string[] | null[], string[] | null[]];
    const [connected, playing, watching, vipPlaying] = viewerCounts;
    const [roundId, roundPlaying, roundCompleted, roundEliminated] = roundStats;
    
    return {
        type: 'broadcastStats',
        statusMessage: '',
        userId: userId,
        viewerCounts: {
            connected: connected ? +connected : 0,
            playing: playing ? +playing : 0,
            watching: watching ? +watching : 0,
            proGamePlayers: vipPlaying ? +vipPlaying : 0
        },
        roundId: roundId ? +roundId : undefined,
        roundPlaying: roundPlaying ? +roundPlaying : undefined,
        roundCompleted: roundCompleted ? +roundCompleted : undefined,
        roundEliminated: roundEliminated ? +roundEliminated : undefined
    } as HqBroadcastStats;
}

export default constructBroadcastStats;

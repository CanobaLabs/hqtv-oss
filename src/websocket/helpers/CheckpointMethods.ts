import redis from '../../common/redisClient';
import { bulkGetUsers } from '../../common/utils/userGetters';
import rGameKey from '../wsTypes/redisGameKeys';
import RedisCheckpoint from '../redisSchemas/redisCheckpoint';
import RedisCheckpointWinnerDeserialised from '../redisSchemas/redisCheckpointWinnerDeserialised';
import generatePrizeDisplayText from './generatePrizeDisplayText';

function checkpointMethods(bcastId: number) {
    const getIds = async () => {
        const [currentId, next, all] = await Promise.all([
            redis.get(rGameKey(bcastId).currentCheckpointId),
            redis.zRangeWithScores(rGameKey(bcastId).nextCheckpointIds, '-inf', '+inf', { BY: 'SCORE' }),
            redis.zRangeWithScores(rGameKey(bcastId).allCheckpointIds, '-inf', '+inf', { BY: 'SCORE' })
        ]);
        return {
            currentId,
            next,
            all
        }
    }
    const getCheckpointInfo = async (specificCpId?: string): Promise<{ nextCheckpoints: { value: string; score: number; }[]; currentCheckpoint: RedisCheckpoint | null; }> => {
        const checkpointIds = await getIds();
        const getId = specificCpId ?? checkpointIds.currentId;
        const currentCheckpoint = getId && await redis.hGetAll(rGameKey(bcastId).checkpoint(getId).cp);
        return {
            nextCheckpoints: checkpointIds.next,
            currentCheckpoint: currentCheckpoint as RedisCheckpoint || null,
        }
    }
    const generateWinners = async (specificCpId?: string): Promise<RedisCheckpointWinnerDeserialised[]> => {
        const getId = specificCpId ?? (await getIds()).currentId;
        if (!getId) return [];
        const [prizes, points] = await Promise.all([
            redis.hGetAll(rGameKey(bcastId).checkpoint(getId).prizes),
            redis.hGetAll(rGameKey(bcastId).checkpoint(getId).points)
        ]);
        if (prizes && Object.keys(prizes).length > 0) {
            const winnerEntries = Object.entries(prizes);
            const userIds = winnerEntries.map(([plrId]) => +plrId);
            const prizeCents = winnerEntries.map(([plrId, prize]) => +prize);
            const prizePoints = winnerEntries.map(([plrId]) => +(points?.[plrId] ?? 0));
            const winnerProfiles = await bulkGetUsers(userIds);
            winnerProfiles.sort((a, b) => +b.booster - +a.booster);
            const winners = winnerProfiles.map((profile, i) => ({
                id: profile.id,
                name: profile.dispName,
                avatarUrl: profile.avatarUrl,
                prize: generatePrizeDisplayText(prizeCents[i], prizePoints[i]),
                userPointsMultiplier: null
            }));
            await redis.set(rGameKey(bcastId).checkpoint(getId).cachedWinners, JSON.stringify(winners));
            return winners;
        }
        return [];
    }
    const getCachedWinners = async (specificCpId?: string): Promise<RedisCheckpointWinnerDeserialised[]> => {
        const getId = specificCpId ?? (await getIds()).currentId;
        const cachedWinners = getId && await redis.get(rGameKey(bcastId).checkpoint(getId).cachedWinners);
        if (cachedWinners) {
            return JSON.parse(cachedWinners);
        }
        return await generateWinners(specificCpId);
    }
    return {
        getIds,
        getCheckpointInfo,
        generateWinners,
        getCachedWinners
    }
}

export default checkpointMethods;

import redis from '../../common/redisClient';
import rGameKey from '../wsTypes/redisGameKeys';
import RedisCheckpoint from '../redisSchemas/redisCheckpoint';
import { outline } from '../../common/mongoClient';

async function replicateCheckpointsToRedis(broadcastId: number, gameId: number, providedOutline?: { outline: any[] }) {
    const gameOutline = providedOutline ?? (await outline.findOne({ gameId: gameId }) ?? { outline: []});
    // Pre-compute question count for each checkpoint to avoid repeated filtering
    const outlineArray = gameOutline.outline;
    let questionCount = 0;
    const redisCheckpoints: RedisCheckpoint[] = [];
    outlineArray.forEach((item, index) => {
        if (item.itemType === "question") {
            questionCount++;
        } else if (item.itemType === "checkpoint") {
            redisCheckpoints.push({
                checkpointId: item.id.toString(),
                questionNumber: questionCount.toString(),
                prizeTotalCents: (item.prizeCents ?? 0).toString(),
                prizeTotalPoints: (item.prizePoints ?? 0).toString(),
                splitPrize: (item.splitPrize ?? false).toString(),
                splitPoints: (item.splitPoints ?? false).toString()
            });
        }
    });

    const multi = redis.multi();
    redisCheckpoints.forEach(payload => {
		    const { checkpointId } = payload;
        multi.hSet(rGameKey(broadcastId).checkpoint(checkpointId).cp, payload);
        multi.zAdd(rGameKey(broadcastId).allCheckpointIds, { value: checkpointId, score: +payload.questionNumber });
    });
    multi.copy(rGameKey(broadcastId).allCheckpointIds, rGameKey(broadcastId).nextCheckpointIds);
    await multi.exec();
    
    return redisCheckpoints;
}

export default replicateCheckpointsToRedis;

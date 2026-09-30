import redis from '../../common/redisClient';
import { getBulkPlayingStatus } from '../helpers/bulkPlayerMethods';
import checkpointMethods from '../helpers/CheckpointMethods';
import rGameKey from '../wsTypes/redisGameKeys';
import HqCheckpointSummary from '../wsMessageTypes/HqCheckpointSummary';
import WsGameInfo from '../wsTypes/WsGameInfo';
import generatePrizeDisplayText from '../helpers/generatePrizeDisplayText';

function constructCheckpointSummary(gameInfo: WsGameInfo, checkpointIdPass?: string) {
    return async function(_: number, playerIds: string[]) {
        const { broadcastId } = gameInfo;
        const [checkpointInfo, winners, playersRemaining, bulkPlayingStatus] = await Promise.all([
            checkpointMethods(broadcastId).getCheckpointInfo(checkpointIdPass),
            checkpointMethods(broadcastId).getCachedWinners(checkpointIdPass),
            redis.sCard(rGameKey(broadcastId).inTheGame),
            getBulkPlayingStatus(broadcastId, playerIds)
        ]);
        const currentCheckpoint = checkpointInfo.currentCheckpoint!;
        const prizeOffer = generatePrizeDisplayText(+(currentCheckpoint.prizeOfferCents ?? 0), +(currentCheckpoint.prizeOfferPoints ?? 0));
        const bulkPrizes = await redis.hmGet(rGameKey(broadcastId).checkpoint(currentCheckpoint.checkpointId).prizes, playerIds);
        
        return playerIds.map((_, i) => {
            const playingStatus = bulkPlayingStatus[i];
            const prize = bulkPrizes[i];
            return {
                type: 'checkpointSummary',
                checkpointId: currentCheckpoint.checkpointId,
                playingStatus: playingStatus,
                prizeOffered: prizeOffer,
                numWinners: winners.length,
                winners: winners,
                playersRemaining: playersRemaining,
                youWon: !!prize,
                questionNumber: gameInfo.questionNumber,
                questionCount: gameInfo.questionCount,
                nextCheckpointIn: checkpointInfo.nextCheckpoints[0] ? (
                    (checkpointInfo.nextCheckpoints[0]?.score - gameInfo.questionNumber) >= 0 ? 
                        (checkpointInfo.nextCheckpoints[0]?.score - gameInfo.questionNumber) :
                        null
                ): null,
                durationMs: 10000,
                userPointsMultiplier: null
            } as HqCheckpointSummary;
        });
    }
}

export default constructCheckpointSummary;

import redis from '../../common/redisClient';
import centsToDollars from '../../common/utils/centsToDollars';
import { getBulkIsPlayerIn, getBulkPlayingStatus } from '../helpers/bulkPlayerMethods';
import checkpointMethods from '../helpers/CheckpointMethods';
import rGameKey from '../wsTypes/redisGameKeys';
import HqCheckpoint from '../wsMessageTypes/HqCheckpoint';
import WsGameInfo from '../wsTypes/WsGameInfo';
import generatePrizeDisplayText from '../helpers/generatePrizeDisplayText';

function constructCheckpoint(gameInfo: WsGameInfo, checkpointIdPass?: string) {
    return async function(_: number, playerIds: string[]) {
        const { broadcastId } = gameInfo;
        const [checkpointInfo, inTheGameCount, bulkPlayerInGame, bulkPlayingStatus] = await Promise.all([
            checkpointMethods(broadcastId).getCheckpointInfo(checkpointIdPass),
            redis.sCard(rGameKey(broadcastId).inTheGame),
            getBulkIsPlayerIn(broadcastId, playerIds),
            getBulkPlayingStatus(broadcastId, playerIds)
        ]);
        const checkpoint = checkpointInfo.currentCheckpoint!;
        const prizeOffer = generatePrizeDisplayText(+(checkpoint.prizeOfferCents ?? 0), +(checkpoint.prizeOfferPoints ?? 0));
        
        const checkpointQuestionNumber = checkpoint.questionNumber ? +checkpoint.questionNumber : null;
        const bulkUsedExtraLife = checkpointQuestionNumber !== null 
            ? await Promise.all(playerIds.map(playerId => 
                redis.sIsMember(rGameKey(broadcastId).question(checkpointQuestionNumber).usedLife, playerId)
            ))
            : playerIds.map(() => false);

        return playerIds.map((_, i) => {
            const inTheGame = bulkPlayerInGame[i];
            const playingStatus = bulkUsedExtraLife[i] ? 'eliminated' : bulkPlayingStatus[i];
            return {
                type: 'checkpoint',
                checkpointId: checkpoint.checkpointId,
                inTheGame: playingStatus == 'playing',
                playingStatus: playingStatus,
                prizeOffered: prizeOffer,
                prizeTotal: generatePrizeDisplayText(gameInfo.prizeCents, gameInfo.prizePoints),
                playersRemaining: inTheGameCount,
                questionNumber: gameInfo.questionNumber,
                questionCount: gameInfo.questionCount,
                nextCheckpointIn: checkpointInfo.nextCheckpoints[0] ? (
                    (checkpointInfo.nextCheckpoints[0]?.score - gameInfo.questionNumber) >= 0 ? 
                        (checkpointInfo.nextCheckpoints[0]?.score - gameInfo.questionNumber) :
                        null
                ): null,
                isFinalCheckpoint: checkpointInfo.nextCheckpoints.length == 0,
                durationMs: 10000,
                userPointsMultiplier: null
            } as HqCheckpoint;
        });
    }
}

export default constructCheckpoint;

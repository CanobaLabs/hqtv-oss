import ms from 'ms';
import logger from '../../common/logger';
import redis from '../../common/redisClient';
import { getBulkIsPlayerIn } from '../helpers/bulkPlayerMethods';
import checkpointMethods from '../helpers/CheckpointMethods';
import rGameKey from '../wsTypes/redisGameKeys';
import HqWebSocket from '../wsTypes/HqWebSocket';
import sendProducerPlayerList from '../helpers/sendProducerPlayerList';
import { getUser } from '../../common/utils/userGetters';
import sendProducerCheckpointTaker from '../helpers/sendProducerCheckpointTaker';

async function handleCheckpointResponse(ws: HqWebSocket, payload: { winNow: boolean; }) {
    function logFail(reason: string) {
        const msg = `Checkpoint claim failed: ${reason}. PlrId=${playerId}, CheckpointId=${checkpointId}`;
        logger.info(msg);
    }
    const { playerId, broadcastId } = ws;
    const checkpointId = (await checkpointMethods(broadcastId).getIds()).currentId!;
    if (!checkpointId) return;
    const [{ currentCheckpoint: checkpoint }, [playerInGame]] = await Promise.all([
        checkpointMethods(broadcastId).getCheckpointInfo(checkpointId),
        getBulkIsPlayerIn(broadcastId, [playerId])
    ]);

    const checkpointQuestionNumber = checkpoint?.questionNumber ? +checkpoint.questionNumber : null;
    if (checkpointQuestionNumber !== null) {
        const usedExtraLife = await redis.sIsMember(rGameKey(broadcastId).question(checkpointQuestionNumber).usedLife, playerId);
        if (usedExtraLife) {
            return logFail('Used extra life on checkpoint question');
        }
    }

    if (payload.winNow) {
        const offerCloseTime = +checkpoint!.offerStarted! + ms('10 seconds') + ms('2 seconds');
        if (Date.now() > offerCloseTime) {
            return logFail('Offer has closed');
        }
        if (!playerInGame) {
            return logFail('Not \'playing\' state');
        }
        const user = await getUser(+playerId);
        const basePrizeOfferPoints = checkpoint!.prizeOfferPoints ? +checkpoint!.prizeOfferPoints : 0;
        const BOOSTER_MULTI = 1.5;
        const prizeOfferPoints = user.booster && basePrizeOfferPoints > 0 
            ? Math.round(basePrizeOfferPoints * BOOSTER_MULTI) 
            : basePrizeOfferPoints;
        const multi = redis.multi()
            .hSet(rGameKey(broadcastId).checkpoint(checkpointId).prizes, playerId, +checkpoint!.prizeOfferCents!)
            .sRem(rGameKey(broadcastId).inTheGame, playerId)
            .sAdd(rGameKey(broadcastId).eliminated, playerId);
        if (prizeOfferPoints > 0 && !isNaN(prizeOfferPoints)) {
            multi.hSet(rGameKey(broadcastId).checkpoint(checkpointId).points, playerId, prizeOfferPoints)
                .hIncrBy(rGameKey(broadcastId).sessionPoints, playerId, prizeOfferPoints);
        }
        await multi.exec();
        // Send player list update to producers after checkpoint elimination
        sendProducerPlayerList(broadcastId).catch(err => logger.error('Failed to send producer player list after checkpoint elimination', err));
        // Send checkpoint taker notification to producers
        sendProducerCheckpointTaker(broadcastId, checkpointId, playerId).catch(err => logger.error('Failed to send producer checkpoint taker', err));
    }
}

export default handleCheckpointResponse;

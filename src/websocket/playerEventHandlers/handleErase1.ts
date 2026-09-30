import redis from '../../common/redisClient';
import HqWebSocket from '../wsTypes/HqWebSocket';
import constructErase1Answer from '../constructors/constructErase1Answer';
import { getQuestion } from '../helpers/gameDataGetters';
import { getErase1sRemaining } from '../helpers/playerMethods';
import rGameKey from '../wsTypes/redisGameKeys';
import getGameInfo from '../helpers/getGameInfo';
import getGeneralConfig from '../../api/utils/getGeneralConfig';

async function handleErase1(ws: HqWebSocket) {
    const { playerId, broadcastId } = ws;
    const config = await getGeneralConfig();
    const [gameInfo, question, lockAcquired] = await Promise.all([
        getGameInfo(ws.broadcastId),
        getQuestion(ws.broadcastId),
        redis.set(rGameKey(broadcastId).usedEraserLock(playerId), 1, { EX: config.eraserLockExpirySec, NX: true })
    ]);
    const alreadyUsedEraser = await redis.sIsMember(rGameKey(broadcastId).question(+gameInfo.questionNumber).usedEraser, playerId);
    const erase1sRemaining = await getErase1sRemaining(ws.player, gameInfo);
    if (!question) return;

    const plrCanUseEraser = (
        erase1sRemaining > 0
        && !alreadyUsedEraser
        && lockAcquired
    );
    if (question.eraserAnswerId != null && plrCanUseEraser) {
        await redis.multi()
            .hIncrBy(rGameKey(broadcastId).erasersUsed, playerId, 1)
            .sAdd(rGameKey(broadcastId).question(+gameInfo.questionNumber).usedEraser, playerId)
            .exec();
        ws.sendGameClient(await constructErase1Answer(ws, question, gameInfo));
    }
}

export default handleErase1;

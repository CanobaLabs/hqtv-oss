import redis from '../../common/redisClient';
import { getUser } from '../../common/utils/userGetters';
import HqWebSocket from '../wsTypes/HqWebSocket';
import constructGameStatus from '../constructors/constructGameStatus';
import constructShowToast from '../constructors/constructShowToast';
import constructViewerUpdate from '../constructors/constructViewerUpdate';
import { getLivesRemaining, sendFriends } from '../helpers/playerMethods';
import rGameKey from '../wsTypes/redisGameKeys';
import getGameInfo from '../helpers/getGameInfo';
import constructViewerEvent from '../constructors/constructViewerEvent';
import getGeneralConfig from '../../api/utils/getGeneralConfig';
import sendProducerPlayerList from '../helpers/sendProducerPlayerList';
import sendProducerExtraLifeCount from '../helpers/sendProducerExtraLifeCount';
import logger from '../../common/logger';

async function handleUseLife(ws: HqWebSocket) {
    const { playerId, broadcastId } = ws;
    const gameInfo = await getGameInfo(broadcastId);
    const [user, currentlyInTheGame, wasJustInTheGame] = await Promise.all([
        getUser(ws.userId),
        redis.sIsMember(rGameKey(broadcastId).inTheGame, playerId),
        redis.sIsMember(rGameKey(broadcastId).question(+gameInfo.questionNumber).roundPlaying, playerId)
    ]);
    const config = await getGeneralConfig();
    const [livesRemaining, alreadyUsedALife, lockAcquired] = await Promise.all([
        getLivesRemaining(ws.player, gameInfo),
        redis.sIsMember(rGameKey(broadcastId).question(+gameInfo.questionNumber).usedLife, playerId),
        redis.set(rGameKey(broadcastId).usedLifeLock(playerId), 1, { EX: config.extraLifeLockExpirySec, NX: true })
    ]);
    const [currentQuestion, questionTotalTimeMs] = await Promise.all([
        redis.exists(rGameKey(broadcastId).question(+gameInfo.questionNumber).q),
        redis.hGet(rGameKey(broadcastId).question(+gameInfo.questionNumber).q, 'totalTimeMs')
    ]);
    if (!currentQuestion) {
        return;
    }
    
    let meetsExtraLifeConditions = false;
    if (!currentlyInTheGame && wasJustInTheGame) {
        if (livesRemaining > 0 && !alreadyUsedALife && lockAcquired) {
            meetsExtraLifeConditions = true;
            const multi = redis.multi()
                .hIncrBy(rGameKey(broadcastId).livesUsed, playerId, 1) // take a life
                .sAdd(rGameKey(broadcastId).question(+gameInfo.questionNumber).usedLife, playerId)
                .sRem(rGameKey(broadcastId).eliminated, playerId)
                .sAdd(rGameKey(broadcastId).inTheGame, playerId);
            if (gameInfo.gameType === 'words') {
                multi.hDel(rGameKey(broadcastId).playerStrikes, playerId); // reset strikes
                multi.hIncrBy(rGameKey(broadcastId).totalSolveTime, playerId, +(questionTotalTimeMs ?? '0'));
            }
            await multi.exec();
            sendFriends(ws.player, constructViewerUpdate(user, 'playing'));
            sendFriends(ws.player, constructViewerEvent(`${user.dispName} used an Extra Life.`, 'usedExtraLife', [user.dispName], user.id));
            // Send player list update to producers when a player uses an extra life
            sendProducerPlayerList(broadcastId).catch(err => logger.error('Failed to send producer player list after extra life use', err));
            // Send extra life count update to producers
            sendProducerExtraLifeCount(broadcastId).catch(err => logger.error('Failed to send producer extra life count', err));
        }
    }
    if (!meetsExtraLifeConditions) {
        return ws.sendGameClient(constructShowToast('Your life could not be accepted', process.env.CDN_URL + '/hqtv/revived.png'));
    }
    
    const savedByLife = await redis.sIsMember(rGameKey(broadcastId).question(+gameInfo.questionNumber).usedLife, playerId);
    if (savedByLife) {
        ws.sendGameClient(await constructGameStatus(gameInfo, ws));
    }
}

export default handleUseLife;

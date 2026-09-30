import { GameBanLevel } from '../../common/enums';
import HqError from '../../common/hqError';
import redis from '../../common/redisClient';
import { bulkGetUsers } from '../../common/utils/userGetters';
import constructShowToast from '../constructors/constructShowToast';
import constructViewerUpdate from '../constructors/constructViewerUpdate';
import countQuestionAnswers from '../helpers/countQuestionAnswers';
import { sendFriends } from '../helpers/playerMethods';
import rGameKey from '../wsTypes/redisGameKeys';
import runGameCommand from './runGameCommand';
import WsGameInfo from '../wsTypes/WsGameInfo';
import CrossServer from '../helpers/CrossServer';
import sendProducerQuestionStatus from '../helpers/sendProducerQuestionStatus';
import sendProducerAnswerCount from '../helpers/sendProducerAnswerCount';
import logger from '../../common/logger';

async function masterQuestionResultsHandler(gameInfo: WsGameInfo, broadcastId: number) {
    const { gameType, questionNumber } = gameInfo;
    if (questionNumber == 0) {
        throw new HqError('Question hasn\'t been asked', 0, 400);
    }
    
    const [resultsReady, lifeEligible] = await redis.multi()
        .get(rGameKey(broadcastId).question(questionNumber).resultsReady)
        .hGet(rGameKey(broadcastId).question(questionNumber).q, 'lifeEligible')
        .exec() as [string, string];
    if (!resultsReady) {
        await countQuestionAnswers(gameInfo);
    }
    const multi = redis.multi();
    multi.hSet(rGameKey(broadcastId).question(questionNumber).q, 'resultsRevealed', 1);
    if (gameType === 'trivia') {
        multi.set(rGameKey(broadcastId).currentState, 'questionSummary');
    } else if (gameType === 'words') {
        multi.set(rGameKey(broadcastId).currentState, 'endRound');
    }
    await multi.exec();
    
    const questionId = +gameInfo.questionId!;
    sendProducerQuestionStatus(broadcastId, questionId).catch(err => logger.error('Failed to send producer question status', err));
    sendProducerAnswerCount(broadcastId).catch(err => logger.error('Failed to send producer answer count', err));

    const justEliminated = await redis.sMembers(rGameKey(broadcastId).question(questionNumber).roundEliminated);
    if (justEliminated.length > 0) {
        const elimUsers = await bulkGetUsers(justEliminated.map(plrId => +plrId));
        elimUsers.forEach(usr => {
            sendFriends({ playerId: usr.id.toString(), broadcastId }, constructViewerUpdate(usr, 'playing'));
        });
    }
    await CrossServer.sendAllServers('questionResults', broadcastId);

    const savedByWinnersCap = await redis.sMembers(rGameKey(broadcastId).question(questionNumber).savedByWinnersCap);
    await CrossServer.sendAllServers('sendPlayers', broadcastId, { playerIds: savedByWinnersCap, payload: constructShowToast(gameType == 'trivia' ? 'You\'re back in the game!' : 'You win!', process.env.CDN_URL + '/hqtv/revived.png') });

    if (gameType == 'trivia') {
    }
    if (questionNumber == 8) {
        const inTheGamePlrIds = await redis.sMembers(rGameKey(broadcastId).inTheGame);
        const usersInTheGame = await bulkGetUsers(inTheGamePlrIds.map(plrId => +plrId));
        const gameBannedPlrIds = usersInTheGame.flatMap(usr => usr.gameBan > GameBanLevel.NotBanned ? usr.id.toString() : []);
        await runGameCommand('kick', broadcastId, gameBannedPlrIds);
    }
}

export default masterQuestionResultsHandler;

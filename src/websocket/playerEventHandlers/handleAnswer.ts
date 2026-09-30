import redis from '../../common/redisClient';
import { getUser } from '../../common/utils/userGetters';
import HqWebSocket from '../wsTypes/HqWebSocket';
import constructAnswered from '../constructors/constructAnswered';
import constructSubmittedAnswer from '../constructors/constructSubmittedAnswer';
import { getQuestion, isQuestionAcceptingAnswers } from '../helpers/gameDataGetters';
import getKeepPlayingConfig from '../helpers/getKeepPlayingConfig';
import { checkIfPlayerInGame, getPlayerAnswerId, isSharingAnswers, sendFriends } from '../helpers/playerMethods';
import rGameKey from '../wsTypes/redisGameKeys';
import getGameInfo from '../helpers/getGameInfo';
import sendProducerAnswerCount from '../helpers/sendProducerAnswerCount';
import logger from '../../common/logger';

async function handleAnswer(ws: HqWebSocket, payload: { answerId: number }) {
    const { playerId, broadcastId } = ws;
    const [user, gameInfo, question, { enabled: kpEnabled }, playerInGame, sharingAnswers] = await Promise.all([
        getUser(ws.userId),
        getGameInfo(ws.broadcastId),
        getQuestion(ws.broadcastId),
        getKeepPlayingConfig(),
        checkIfPlayerInGame(ws.player),
        isSharingAnswers(ws.player),
    ]);
    if (!question) {
        return;
    }

    if (isQuestionAcceptingAnswers(question)) {
        if (typeof payload.answerId === 'number') {
            if (playerInGame) {
                await redis.zAdd(rGameKey(broadcastId).question(+gameInfo.questionNumber).playerAnswers, { value: playerId, score: payload.answerId });
                const isCheckpointQuestion = await redis.zRangeByScore(rGameKey(broadcastId).allCheckpointIds, +gameInfo.questionNumber, +gameInfo.questionNumber, { LIMIT: { offset: 0, count: 1 } });
                if (sharingAnswers && !user.admin && !user.tester && +gameInfo.questionNumber <= 8 && isCheckpointQuestion.length === 0) {
                    sendFriends(ws.player, constructAnswered(user, +question.id, payload.answerId));
                }
                sendProducerAnswerCount(broadcastId).catch(err => logger.error('Failed to send producer answer count', err));
            } else if (kpEnabled) {
                await redis.zAdd(rGameKey(broadcastId).question(+gameInfo.questionNumber).keepPlayingAnswers, { value: playerId, score: payload.answerId });
                sendProducerAnswerCount(broadcastId).catch(err => logger.error('Failed to send producer answer count', err));
            }
        }
    }
    const submittedAnswerId = await getPlayerAnswerId(ws.player, +gameInfo.questionNumber);
    ws.sendGameClient(constructSubmittedAnswer(+question.id, submittedAnswerId));
}

export default handleAnswer;

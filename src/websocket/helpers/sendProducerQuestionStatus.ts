import redis from '../../common/redisClient';
import rGameKey from '../wsTypes/redisGameKeys';
import getQuestionStatus from './getQuestionStatus';
import CrossServer from './CrossServer';

async function sendProducerQuestionStatus(broadcastId: number, questionId: number) {
    const questionIds = await redis.lRange(rGameKey(broadcastId).questionIds, 0, -1);
    const questionNumber = questionIds.findIndex(qId => +qId === questionId) + 1;
    
    if (questionNumber === 0) {
        return;
    }

    const status = await getQuestionStatus(broadcastId, questionId);

    const statusMessage = {
        type: 'questionStatus',
        questionId: questionId,
        questionNumber: questionNumber,
        status: status
    };

    await CrossServer.sendAllServers('producerMessage', broadcastId, { message: statusMessage });
}

export default sendProducerQuestionStatus;


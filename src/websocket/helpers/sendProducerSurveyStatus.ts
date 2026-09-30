import redis from '../../common/redisClient';
import rGameKey from '../wsTypes/redisGameKeys';
import getSurveyStatus from './getSurveyStatus';
import CrossServer from './CrossServer';

async function sendProducerSurveyStatus(broadcastId: number, surveyQuestionId: string) {
    const allSurveyQuestionIds = await redis.lRange(rGameKey(broadcastId).allSurveyQuestionIds, 0, -1);
    const surveyIndex = allSurveyQuestionIds.findIndex(id => id === surveyQuestionId);
    
    if (surveyIndex === -1) {
        return;
    }

    const status = await getSurveyStatus(broadcastId, surveyQuestionId);

    const statusMessage = {
        type: 'surveyStatus',
        surveyQuestionId: surveyQuestionId,
        status: status
    };

    await CrossServer.sendAllServers('producerMessage', broadcastId, { message: statusMessage });
}

export default sendProducerSurveyStatus;


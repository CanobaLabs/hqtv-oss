import redis from '../../common/redisClient';
import HqWebSocket from '../wsTypes/HqWebSocket';
import rGameKey from '../wsTypes/redisGameKeys';
import { getCurrentSurveyQId, getSurveyQuestion } from '../helpers/surveyQuestionMethods';
import sendProducerSurveyCount from '../helpers/sendProducerSurveyCount';
import logger from '../../common/logger';

async function handleSurveyAnswer(ws: HqWebSocket, payload: { surveyAnswerId: string; }) {
    const { playerId, broadcastId } = ws;
    const timeNow = Date.now();
    const surveyQId = await getCurrentSurveyQId(broadcastId);
    if (!surveyQId) return; // no question
    const { answers, endTime } = await getSurveyQuestion(broadcastId, surveyQId);
    const answerIds = answers.map(a => a.surveyAnswerId);

    if (timeNow > +(endTime ?? 0)) return; // out of time
    if (!answerIds.includes(payload.surveyAnswerId)) return; // invalid answer
    
    const multi = redis.multi();
    answerIds.forEach(id => {
        // clear last response (if one)
        multi.sRem(rGameKey(broadcastId).surveyAnswerVotes(surveyQId, id), playerId);
    });
    // record new response
    multi.sAdd(rGameKey(broadcastId).surveyAnswerVotes(surveyQId, payload.surveyAnswerId), playerId);
    await multi.exec();
    
    sendProducerSurveyCount(broadcastId).catch(err => logger.error('Failed to send producer survey count', err));
}

export default handleSurveyAnswer;

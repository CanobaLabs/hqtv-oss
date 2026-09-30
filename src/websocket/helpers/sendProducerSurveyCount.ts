import redis from '../../common/redisClient';
import { getCurrentSurveyQId, getSurveyQuestion } from './surveyQuestionMethods';
import rGameKey from '../wsTypes/redisGameKeys';
import CrossServer from './CrossServer';

async function sendProducerSurveyCount(broadcastId: number) {
    const surveyQId = await getCurrentSurveyQId(broadcastId);
    if (!surveyQId) {
        return;
    }

    const surveyQuestion = await getSurveyQuestion(broadcastId, surveyQId);
    
    const answerCounts: { [answerId: string]: number } = {};
    
    const voteCounts = await Promise.all(
        surveyQuestion.answers.map(a =>
            redis.sCard(rGameKey(broadcastId).surveyAnswerVotes(surveyQId, a.surveyAnswerId))
        )
    );

    surveyQuestion.answers.forEach((answer, index) => {
        answerCounts[answer.surveyAnswerId] = voteCounts[index];
    });

    const countMessage = {
        type: 'surveyCount',
        surveyQuestionId: surveyQId,
        answerCounts: answerCounts
    };

    await CrossServer.sendAllServers('producerMessage', broadcastId, { message: countMessage });
}

export default sendProducerSurveyCount;


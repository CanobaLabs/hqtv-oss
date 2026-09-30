import redis from '../../common/redisClient';
import { getSurveyQuestion } from './surveyQuestionMethods';
import rGameKey from '../wsTypes/redisGameKeys';

type SurveyStatus = 'notStarted' | 'visible' | 'results' | 'complete';

async function getSurveyStatus(broadcastId: number, surveyQuestionId: string): Promise<SurveyStatus> {
    const startTime = await redis.hGet(rGameKey(broadcastId).surveyQuestion(surveyQuestionId), 'startTime');
    if (!startTime) {
        return 'notStarted';
    }
    
    const resultsSent = await redis.hGet(rGameKey(broadcastId).surveyQuestion(surveyQuestionId), 'resultsSent');
    if (!resultsSent) {
        return 'visible';
    }
    
    const surveyQuestion = await getSurveyQuestion(broadcastId, surveyQuestionId);
    const resultsSentTime = +resultsSent;
    const now = Date.now();
    const resultsDurationMs = surveyQuestion.resultsDisplayMs;
    
    if (now < resultsSentTime + resultsDurationMs) {
        return 'results';
    }
    
    return 'complete';
}

export default getSurveyStatus;
export type { SurveyStatus };




import ms from 'ms';
import HqError from '../../common/hqError';
import logger from '../../common/logger';
import redis from '../../common/redisClient';
import { addExistingSurveyQuestions } from '../helpers/replicateSurveysToRedis';
import { getSurveyQuestion } from '../helpers/surveyQuestionMethods';
import rGameKey from '../wsTypes/redisGameKeys';
import WsGameInfo from '../wsTypes/WsGameInfo';
import masterSurveyResultsHandler from './masterSurveyResultsHandler';
import CrossServer from '../helpers/CrossServer';
import sendProducerSurveyStatus from '../helpers/sendProducerSurveyStatus';

async function masterSurveyQuestionHandler(gameInfo: WsGameInfo, broadcastId: number, addSurveyQuestion?: { new: [string, string]; } | { surveyQuestionId: number; }) {
    let surveyQuestionId!: string;
        const nextSurveyQuestionId = await redis.lPop(rGameKey(broadcastId).nextSurveyQuestionIds);
        if (!nextSurveyQuestionId) {
            throw new HqError('End of survey questions', 0, 400);
        }
        surveyQuestionId = nextSurveyQuestionId;
    
    const surveyQuestion = await getSurveyQuestion(broadcastId, surveyQuestionId);
    const technicalDurationMs = surveyQuestion.durationMs;
    const durationInApp = technicalDurationMs + ms('3 seconds');
    const startTime = Date.now();
    const endTime = startTime + durationInApp + ms('2 seconds'); // 3-second timer delay in the app + 2-second buffer
    await redis.multi()
        .hSet(rGameKey(broadcastId).surveyQuestion(surveyQuestionId), 'startTime', startTime.toString())
        .hSet(rGameKey(broadcastId).surveyQuestion(surveyQuestionId), 'endTime', endTime.toString())
        .set(rGameKey(broadcastId).currentSurveyQuestionId, surveyQuestionId)
        .exec();
    await CrossServer.sendAllServers('surveyQuestion', broadcastId, { surveyQuestionId: surveyQuestionId });
    
    sendProducerSurveyStatus(broadcastId, surveyQuestionId).catch(err => logger.error('Failed to send producer survey status', err));

    // auto-reveal results
    const revealResultsMs = endTime - startTime;
    setTimeout(() => {
        masterSurveyResultsHandler(gameInfo, broadcastId).catch((err) => {
            logger.error({ err, broadcastId, gameId: gameInfo.gameId }, 'Error in masterSurveyResultsHandler');
        });
    }, revealResultsMs);
    return surveyQuestion;
}

export default masterSurveyQuestionHandler;

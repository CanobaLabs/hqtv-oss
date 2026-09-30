import CrossServer from '../helpers/CrossServer';
import { getCurrentSurveyQId, getSurveyQuestion, getSurveyQuestionResults } from '../helpers/surveyQuestionMethods';
import WsGameInfo from '../wsTypes/WsGameInfo';
import redis from '../../common/redisClient';
import rGameKey from '../wsTypes/redisGameKeys';
import sendProducerSurveyStatus from '../helpers/sendProducerSurveyStatus';
import logger from '../../common/logger';

async function masterSurveyResultsHandler(gameInfo: WsGameInfo, broadcastId: number) {
	const surveyQId = await getCurrentSurveyQId(broadcastId);
	const surveyQuestion = await getSurveyQuestion(broadcastId, surveyQId);
	await CrossServer.sendAllServers('surveyResults', broadcastId, { surveyQuestionId: surveyQId });
	const surveyResults = await getSurveyQuestionResults(broadcastId, surveyQuestion.answers, surveyQId);
	
	const resultsSentTime = Date.now();
	await redis.hSet(rGameKey(broadcastId).surveyQuestion(surveyQId), 'resultsSent', resultsSentTime.toString());
	
	sendProducerSurveyStatus(broadcastId, surveyQId).catch(err => logger.error('Failed to send producer survey status', err));
	
	// auto-transition to complete after resultsDuration (resultsDisplayMs)
	setTimeout(() => {
		sendProducerSurveyStatus(broadcastId, surveyQId).catch(err => logger.error('Failed to send producer survey status (complete)', err));
	}, surveyQuestion.resultsDisplayMs);
	
    return surveyResults;
}

export default masterSurveyResultsHandler;

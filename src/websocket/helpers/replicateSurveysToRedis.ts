import { nanoid } from 'nanoid';
import { Op } from 'sequelize';
import SurveyAnswer from '../../common/database/featureModels/surveyAnswer';
import SurveyQuestion from '../../common/database/featureModels/surveyQuestion';
import HqError from '../../common/hqError';
import redis from '../../common/redisClient';
import rGameKey from '../wsTypes/redisGameKeys';
import RedisSurveyQuestion from '../redisSchemas/redisSurveyQuestion';
import { outline } from '../../common/mongoClient';

const replicateSurveyQuestionsToRedis = async (broadcastId: number, surveyQuestions: RedisSurveyQuestion[]) => {
    const multi = redis.multi();
    console.log("adding survey questions to redis", surveyQuestions);
    surveyQuestions.forEach(q => {
        multi.hSet(rGameKey(broadcastId).surveyQuestion(q.surveyQuestionId), Object.entries(q));
        multi.rPush(rGameKey(broadcastId).allSurveyQuestionIds, q.surveyQuestionId);
        multi.rPush(rGameKey(broadcastId).nextSurveyQuestionIds, q.surveyQuestionId);
    });
    await multi.exec();

    return surveyQuestions;
}

export const addExistingSurveyQuestions = async (broadcastId: number, findBy: { gameId: number; }, providedOutline?: { outline: any[] }) => {
    const gameOutline = providedOutline ?? (await outline.findOne({ gameId: findBy.gameId }) ?? { outline: []});

    const redisSurveys: RedisSurveyQuestion[] = gameOutline.outline.filter(o => o.itemType == "survey").map(q => {
        const parsedAnswers = (q.responses ?? []).map((a: any) => ({
            surveyAnswerId: a.id.toString(),
            text: a.response ?? ''
        }));
        return {
            surveyQuestionId: `${q.id}`,
            durationMs: q.askDuration?.toString() ?? '10000',
            question: q.survey ?? '',
            answers: JSON.stringify(parsedAnswers),
            resultsDisplayMs: q.resultsDuration?.toString() ?? '10000'
        }
    });
    return await replicateSurveyQuestionsToRedis(broadcastId, redisSurveys);
}
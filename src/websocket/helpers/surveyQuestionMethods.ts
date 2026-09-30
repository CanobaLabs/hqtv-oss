import percentRound from 'percent-round';
import redis from '../../common/redisClient';
import rGameKey from '../wsTypes/redisGameKeys';
import RedisSurveyQuestion from '../redisSchemas/redisSurveyQuestion';
import WsSurveyQuestion from '../wsTypes/WsSurveyQuestion';

export const getCurrentSurveyQId = async (bcastId: number): Promise<string> => {
    return await redis.get(rGameKey(bcastId).currentSurveyQuestionId) ?? '0';
}

export const getSurveyQuestion = async (bcastId: number, surveyQIdPass?: string): Promise<WsSurveyQuestion> => {
    const surveyQId = surveyQIdPass ?? await getCurrentSurveyQId(bcastId);
    const e = await redis.hGetAll(rGameKey(bcastId).surveyQuestion(surveyQId)) as RedisSurveyQuestion;
    return {
        id: e.surveyQuestionId,
        durationMs: +e.durationMs,
        question: e.question,
        answers: JSON.parse(e.answers),
        resultsDisplayMs: +e.resultsDisplayMs,
        startTime: e.startTime ? +e.startTime : null,
        endTime: e.endTime ? +e.endTime : null
    };
}

export const getSurveyQuestionResults = async (bcastId: number, surveyAnswers: WsSurveyQuestion['answers'], surveyQIdPass?: string) => {
    const surveyQId = surveyQIdPass ?? await getCurrentSurveyQId(bcastId);
    const voteCounts = await Promise.all(
        surveyAnswers.map(a => redis.sCard(rGameKey(bcastId).surveyAnswerVotes(surveyQId, a.surveyAnswerId)))
    )
    const totalVoteCount = voteCounts.reduce((total, curr) => total + curr, 0);
    
    return {
        answerResults: surveyAnswers.map((a, i) => {
            const voteCount = voteCounts[i];
            const [votePercent] = percentRound([voteCount, totalVoteCount - voteCount]);
            return {
                surveyAnswerId: a.surveyAnswerId,
                displayText: a.text,
                displayCount: votePercent + '%',
                voteCount: voteCount 
            }
        }).sort((a, b) => b.voteCount - a.voteCount),
        totalVoteCount: totalVoteCount
    }
}

import { getSurveyQuestion, getSurveyQuestionResults } from '../helpers/surveyQuestionMethods';
import HqSurveyResults from '../wsMessageTypes/HqSurveyResults';

async function constructSurveyResults(broadcastId: number, surveyQIdPass?: string) {
    const surveyQuestion = await getSurveyQuestion(broadcastId, surveyQIdPass);
    const surveyResults = await getSurveyQuestionResults(broadcastId, surveyQuestion.answers, surveyQuestion.id.toString());
    return {
        type: 'surveyResults',
        surveyQuestionId: surveyQuestion.id,
        question: surveyQuestion.question,
        results: surveyResults.answerResults,
        voteCount: surveyResults.totalVoteCount,
        durationMs: surveyQuestion.resultsDisplayMs
    } as HqSurveyResults;
}

export default constructSurveyResults;

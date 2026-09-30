import { getSurveyQuestion } from '../helpers/surveyQuestionMethods';
import HqSurveyQuestion from '../wsMessageTypes/HqSurveyQuestion';

async function constructSurveyQuestion(broadcastId: number, surveyQIdPass?: string) {
    const surveyQ = await getSurveyQuestion(broadcastId, surveyQIdPass);
    return {
        type: 'surveyQuestion',
        surveyQuestionId: surveyQ.id,
        question: surveyQ.question,
        answers: surveyQ.answers.map(a => ({ surveyAnswerId: a.surveyAnswerId, displayText: a.text })),
        durationMs: surveyQ.durationMs,
        dismissDurationMs: 0
    } as HqSurveyQuestion;
}

export default constructSurveyQuestion;

import constructSurveyQuestion from '../constructors/constructSurveyQuestion';
import { wsServers } from '../wsServers';

interface SubSurveyQuestionArgs {
    surveyQuestionId: string;
}

async function subSurveyQuestionHandler(broadcastId: number, e: SubSurveyQuestionArgs) {
    wsServers[broadcastId]?.wss.sendAll(await constructSurveyQuestion(broadcastId, e.surveyQuestionId));
}

export { SubSurveyQuestionArgs, subSurveyQuestionHandler };


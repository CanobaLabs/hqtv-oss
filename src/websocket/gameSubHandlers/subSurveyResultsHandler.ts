import constructSurveyResults from '../constructors/constructSurveyResults';
import { wsServers } from '../wsServers';

interface SubSurveyResultsArgs {
    surveyQuestionId: string;
}

async function subSurveyResultsHandler(broadcastId: number, e: SubSurveyResultsArgs) {
    wsServers[broadcastId]?.wss.sendAll(await constructSurveyResults(broadcastId, e.surveyQuestionId));
}

export { SubSurveyResultsArgs, subSurveyResultsHandler };

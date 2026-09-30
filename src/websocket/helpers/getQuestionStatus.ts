import redis from '../../common/redisClient';
import { getQuestion, getPuzzle } from './gameDataGetters';
import getGameInfo from './getGameInfo';
import rGameKey from '../wsTypes/redisGameKeys';

type QuestionStatus = 'notStarted' | 'visible' | 'explanation' | 'results' | 'complete';

async function getQuestionStatus(broadcastId: number, questionId: number): Promise<QuestionStatus> {
    const questionIds = await redis.lRange(rGameKey(broadcastId).questionIds, 0, -1);
    const questionNumber = questionIds.findIndex(qId => +qId === questionId) + 1;
    
    if (questionNumber === 0) {
        return 'notStarted';
    }
    
    const gameInfo = await getGameInfo(broadcastId);
    const currentQuestionNumber = +gameInfo.questionNumber;
    const currentState = await redis.get(rGameKey(broadcastId).currentState);
    
    const askTime = await redis.hGet(rGameKey(broadcastId).question(questionNumber).q, 'askTime');
    if (!askTime) {
        return 'notStarted';
    }
    
    const question = await getQuestion(broadcastId, questionNumber);
    const puzzle = question ? null : await getPuzzle(broadcastId, questionNumber);
    
    const resultsRevealed = await redis.hGet(rGameKey(broadcastId).question(questionNumber).q, 'resultsRevealed');
    const hasResultsRevealed = resultsRevealed === '1';
    
    if (questionNumber < currentQuestionNumber) {
        return 'complete';
    }
    
    if (questionNumber > currentQuestionNumber) {
        return 'notStarted';
    }
    
    if (hasResultsRevealed) {
        if (currentState === 'questionSummary' || currentState === 'endRound') {
            return 'results';
        } else {
            return 'complete';
        }
    }
    
    if (currentState === 'questionClosed') {
        return 'explanation';
    }
    
    if (currentState === 'question' || currentState === 'startRound') {
        if (question) {
            const answerCounts = await redis.hGet(rGameKey(broadcastId).question(questionNumber).q, 'answerCounts');
            if (!answerCounts) {
                return 'visible';
            }
        } else if (puzzle) {
            return 'visible';
        }
        return 'explanation';
    }
    
    return 'explanation';
}

export default getQuestionStatus;
export type { QuestionStatus };


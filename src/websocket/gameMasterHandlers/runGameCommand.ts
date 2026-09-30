import HqError from '../../common/hqError';
import redis from '../../common/redisClient';
import getGameInfo from '../helpers/getGameInfo';
import rGameKey from '../wsTypes/redisGameKeys';
import WsGameInfo from '../wsTypes/WsGameInfo';
import masterCalloutHandler from './masterCalloutHandler';
import masterChatAnnounce from './masterChatAnnounce';
import masterPrivateChatAnnounce from './masterPrivateChatAnnounce';
import masterCheckpointHandler from './masterCheckpointHandler';
import masterCheckpointSummaryHandler from './masterCheckpointSummary';
import masterCloseHandler from './masterCloseHandler';
import masterCustomHandler from './masterCustomHandler';
import masterDisableChatHandler from './masterDisableChatHandler';
import masterDynamicPotAnimationHandler from './masterDynamicPotAnimationHandler';
import masterEndGameHandler from './masterEndGameHandler';
import masterEliminateHandler from './masterEliminateHandler';
import masterGiftDropHandler from './masterGiftDropHandler';
import masterKickHandler from './masterKickHandler';
import masterNextLogicalHandler from './masterNextLogicalHandler';
import masterQuestionHandler from './masterQuestionHandler';
import masterQuestionResultsHandler from './masterQuestionResultsHandler';
import masterRevealLetterHandler from './masterRevealLetterHandler';
import masterRevivePlayersHandler from './masterRevivePlayersHandler';
import masterSurveyQuestionHandler from './masterSurveyQuestionHandler';
import masterSurveyResultsHandler from './masterSurveyResultsHandler';
import masterWheelHandler from './masterWheelHandler';
import masterWinnersHandler from './masterWinnersHandler';

type GameCommand = (
    'question'
    | 'surveyQuestion'
    | 'surveyResults'
    | 'checkpoint'
    | 'checkpointSummary'
    | 'giftDrop'
    | 'questionResults'
    | 'winners'
    | 'close'
    | 'nextLogical'
    | 'revealLetter'
    | 'wheel'
    | 'kick'
    | 'eliminate'
    | 'revivePlayers'
    | 'chatAnnounce'
    | 'privateChatAnnounce'
    | 'disableChat'
    | 'dynamicPotAnimation'
    | 'custom'
    | 'endGame'
    | 'callout'
);

const gameCommandMap: { [gameCmd in GameCommand]: [ (gameInfo: WsGameInfo, broadcastId: number, param?: any) => unknown, string[] ]; } = {
    'question': [masterQuestionHandler, ['trivia', 'words']],
    'surveyQuestion': [masterSurveyQuestionHandler, ['trivia', 'words']],
    'surveyResults': [masterSurveyResultsHandler, ['trivia', 'words']],
    'checkpoint': [masterCheckpointHandler, ['trivia']],
    'checkpointSummary': [masterCheckpointSummaryHandler, ['trivia']],
    'giftDrop': [masterGiftDropHandler, ['trivia']],
    'questionResults': [masterQuestionResultsHandler, ['trivia', 'words']],
    'winners': [masterWinnersHandler, ['trivia', 'words']],
    'close': [masterCloseHandler, ['trivia', 'words']],
    'nextLogical': [masterNextLogicalHandler, ['trivia', 'words']],
    'revealLetter': [masterRevealLetterHandler, ['words']],
    'wheel': [masterWheelHandler, ['words']],
    'kick': [masterKickHandler, ['trivia', 'words']],
    'eliminate': [masterEliminateHandler, ['trivia', 'words']],
    'revivePlayers': [masterRevivePlayersHandler, ['trivia', 'words']],
    'chatAnnounce': [masterChatAnnounce, ['trivia', 'words']],
    'privateChatAnnounce': [masterPrivateChatAnnounce, ['trivia', 'words']],
    'disableChat': [masterDisableChatHandler, ['trivia', 'words']],
    'dynamicPotAnimation': [masterDynamicPotAnimationHandler, ['trivia']],
    'custom': [masterCustomHandler, ['trivia', 'words']],
    'endGame': [masterEndGameHandler, ['trivia', 'words']],
    'callout': [masterCalloutHandler, ['trivia']],
}

async function runGameCommand(command: GameCommand, broadcastId: number, arg?: unknown) {
    const [gameInfo, gameActive] = await Promise.all([
        getGameInfo(broadcastId),
        redis.exists(rGameKey(broadcastId).gameActiveFlag)
    ]);
    if (!gameActive) {
        throw new HqError('That broadcast does not exist or has ended', 0, 404);
    }
    
    const [handler, compatibleGameTypes] = gameCommandMap[command];
    if (!compatibleGameTypes.includes(gameInfo.gameType)) {
        throw new HqError('That feature is not compatible with the current game type', 0, 400);
    }
    const result = await handler(gameInfo, broadcastId, arg) ?? {};
    await redis.del(rGameKey(broadcastId).runCommandLock); // command fully processed, ready for next command
    return result;
}

export default runGameCommand;

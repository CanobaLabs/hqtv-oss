import HqWebSocket from './HqWebSocket';
import handleAnswer from '../playerEventHandlers/handleAnswer';
import handleChatVisibilityToggled from '../playerEventHandlers/handleChatVisibilityToggled';
import handleErase1 from '../playerEventHandlers/handleErase1';
import handleGuess from '../playerEventHandlers/handleGuess';
import handleInteraction from '../playerEventHandlers/handleInteraction';
import handleSpin from '../playerEventHandlers/handleSpin';
import handleSubscribe from '../playerEventHandlers/handleSubscribe';
import handleSurveyAnswer from '../playerEventHandlers/handleSurveyAnswer';
import handleToggleSharing from '../playerEventHandlers/handleToggleSharing';
import handleUseLife from '../playerEventHandlers/handleUseExtraLife';
import handleCheckpointResponse from '../playerEventHandlers/handleCheckpointResponse';

type Handler = (ws: HqWebSocket, payload: any) => Promise<unknown> | unknown;
const playerEventHandlers: { [eventName in PlayerEventName]: [Handler, string[]] } = {
    'subscribe': [handleSubscribe, ['trivia', 'words']],
    'chatVisibilityToggled': [handleChatVisibilityToggled, ['trivia', 'words']],
    'interaction': [handleInteraction, ['trivia', 'words']],
    'useExtraLife': [handleUseLife, ['trivia', 'words']],
    'erase1': [handleErase1, ['trivia']],
    'toggleSharing': [handleToggleSharing, ['trivia']],
    'answer': [handleAnswer, ['trivia']],
    'checkpointResponse': [handleCheckpointResponse, ['trivia']],
    'guess': [handleGuess, ['words']],
    'spin': [handleSpin, ['words']],
    'surveyAnswer': [handleSurveyAnswer, ['trivia', 'words']]
}

type PlayerEventName = (
    'subscribe'
    | 'chatVisibilityToggled'
    | 'interaction'
    | 'useExtraLife'
    | 'erase1'
    | 'toggleSharing'
    | 'answer'
    | 'checkpointResponse'
    | 'guess'
    | 'spin'
    | 'surveyAnswer'
);

export { PlayerEventName, playerEventHandlers };


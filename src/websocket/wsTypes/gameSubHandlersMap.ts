import { subBroadcastEndedHandler } from '../gameSubHandlers/subBroadcastEndedHandler';
import { subCalloutHandler } from '../gameSubHandlers/subCalloutHandler';
import { subChatAnnounceHandler } from '../gameSubHandlers/subChatAnnounceHandler';
import { subPrivateChatAnnounceHandler } from '../gameSubHandlers/subPrivateChatAnnounceHandler';
import { subCloseHandler } from '../gameSubHandlers/subCloseHandler';
import { subCustomHandler } from '../gameSubHandlers/subCustomHandler';
import { subChatDisabledHandler } from '../gameSubHandlers/subChatDisabledHandler';
import { subDisconnectLastClientHandler } from '../gameSubHandlers/subDisconnectLastClientHandler';
import { subDynamicPotAnimationHandler } from '../gameSubHandlers/subDynamicPotAnimationHandler';
import { subInteractionHandler } from '../gameSubHandlers/subInteractionHandler';
import { subEliminatedHandler } from '../gameSubHandlers/subEliminatedHandler';
import { subKickHandler } from '../gameSubHandlers/subKickHandler';
import { subQuestionHandler } from '../gameSubHandlers/subQuestionHandler';
import { subQuestionResultsHandler } from '../gameSubHandlers/subQuestionResultsHandler';
import { subLetterRevealHandler } from '../gameSubHandlers/subLetterRevealHandler';
import { subGiftDropHandler } from '../gameSubHandlers/subGiftDropsHandler';
import { subSendPlayersHandler } from '../gameSubHandlers/subSendPlayersHandler';
import { subRevived } from '../gameSubHandlers/subRevivedHandler';
import { subSurveyQuestionHandler } from '../gameSubHandlers/subSurveyQuestionHandler';
import { subSurveyResultsHandler } from '../gameSubHandlers/subSurveyResultsHandler';
import { subWheelHandler } from '../gameSubHandlers/subWheelHandler';
import { subWinnersHandler } from '../gameSubHandlers/subWinnersHandler';
import { subBroadcastStatsHandler } from '../gameSubHandlers/subBroadcastStatsHandler';
import subCheckpointHandler from '../gameSubHandlers/subCheckpointHandler';
import subCheckpointSummaryHandler from '../gameSubHandlers/subCheckpointSummaryHandler';
import { subProducerMessageHandler } from '../gameSubHandlers/subProducerMessageHandler';

const gameSubHandlers = {
    'question': subQuestionHandler,
    'questionResults': subQuestionResultsHandler,
    'checkpoint': subCheckpointHandler,
    'checkpointSummary': subCheckpointSummaryHandler,
    'winners': subWinnersHandler,
    'close': subCloseHandler,
    'surveyQuestion': subSurveyQuestionHandler,
    'surveyResults': subSurveyResultsHandler,
    'giftDrop': subGiftDropHandler,
    'wheel': subWheelHandler,
    'letterReveal': subLetterRevealHandler,
    'chatDisabled': subChatDisabledHandler,
    'interaction': subInteractionHandler,
    'chatAnnounce': subChatAnnounceHandler,
    'privateChatAnnounce': subPrivateChatAnnounceHandler,
    'revived': subRevived,
    'sendPlayers': subSendPlayersHandler,
    'kick': subKickHandler,
    'eliminated': subEliminatedHandler,
    'disconnectLastClient': subDisconnectLastClientHandler,
    'broadcastStats': subBroadcastStatsHandler,
    'broadcastEnded': subBroadcastEndedHandler,
    'dynamicPotAnimation': subDynamicPotAnimationHandler,
    'custom': subCustomHandler,
    'callout': subCalloutHandler,
    'producerMessage': subProducerMessageHandler
}

export default gameSubHandlers;


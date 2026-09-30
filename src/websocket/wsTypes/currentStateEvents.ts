import HqWebSocket from './HqWebSocket';
import constructClose from '../constructors/constructClose';
import constructEndRound from '../constructors/constructEndRound';
import constructGameSummary from '../constructors/constructGameSummary';
import constructQuestion from '../constructors/constructQuestion';
import constructQuestionSummary from '../constructors/constructQuestionSummary';
import constructStartRound from '../constructors/constructStartRound';
import constructWordsGameResult from '../constructors/constructWordsGameResult';
import WsGameInfo from './WsGameInfo';

type CurrentStateType = (
    'question'
    | 'questionSummary'
    | 'gameSummary'
    | 'startRound'
    | 'endRound'
    | 'wordsGameResult'
    | 'questionClosed'
    | 'questionFinished'
    | 'postGame'
    | 'hideWheel'
);

type Handler = (gameInfo: WsGameInfo) => (broadcastId: number, playerIds: string[]) => Promise<Record<string, unknown>[]>;
const currentStateConstructors: { [currentState in CurrentStateType]: Handler; } = {
    'question': constructQuestion,
    'questionSummary': constructQuestionSummary,
    'gameSummary': constructGameSummary,
    'startRound': constructStartRound,
    'endRound': constructEndRound,
    'wordsGameResult': constructWordsGameResult,
    'questionClosed': constructClose,
    'questionFinished': constructClose,
    'postGame': constructClose,
    'hideWheel': constructClose
}

export { CurrentStateType, currentStateConstructors };


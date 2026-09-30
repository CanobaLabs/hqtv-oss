import redis from '../../common/redisClient';
import { CurrentStateType } from '../wsTypes/currentStateEvents';
import { getPuzzle } from '../helpers/gameDataGetters';
import rGameKey from '../wsTypes/redisGameKeys';
import WsGameInfo from '../wsTypes/WsGameInfo';
import runGameCommand from './runGameCommand';

async function masterNextLogicalHandler(gameInfo: WsGameInfo, broadcastId: number) {
    const currentState = await redis.get(rGameKey(broadcastId).currentState) as CurrentStateType | null;

    if (!currentState) {
        if (gameInfo.gameType === 'words' && !(+gameInfo.wheelRevealed!)) {
            return runGameCommand('wheel', broadcastId).catch(() => runGameCommand('question', broadcastId));
        } else {
            return runGameCommand('question', broadcastId);
        }
    } else if (currentState === 'hideWheel') {
        return runGameCommand('question', broadcastId);
    } else if (
        currentState === 'question'
        || currentState === 'questionSummary'
        || currentState === 'startRound'
        || currentState === 'endRound'
        || currentState === 'gameSummary'
        || currentState === 'wordsGameResult'
    ) {
        return runGameCommand('close', broadcastId);
    } else if (currentState === 'questionClosed') {
        if (gameInfo.gameType === 'words') {
            const puzzle = await getPuzzle(broadcastId);
            if (puzzle?.resultsRevealed) {
                return runGameCommand('question', broadcastId).catch(() => runGameCommand('winners', broadcastId));
            }
        }
        return runGameCommand('questionResults', broadcastId);
    } else if (currentState === 'questionFinished') {
        return runGameCommand('question', broadcastId).catch(() => runGameCommand('winners', broadcastId));
    } else if (currentState === 'postGame') {
        return runGameCommand('endGame', broadcastId);
    }
}

export default masterNextLogicalHandler;

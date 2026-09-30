import HqWebSocket from '../wsTypes/HqWebSocket';
import WsPuzzle from '../wsTypes/WsPuzzle';
import { checkIfPlayerInGame, getPuzzleState, getRoundSolveTime, getStrikesUsed } from '../helpers/playerMethods';
import HqGuessResponse from '../wsMessageTypes/HqGuessResponse';
import HqLetterReveal from '../wsMessageTypes/HqLetterReveal';
import WsGameInfo from '../wsTypes/WsGameInfo';

function constructLetterResponse(gameInfo: WsGameInfo, puzzle: WsPuzzle, letter: string, type: 'guessResponse' | 'letterReveal') {
    return async function(ws: HqWebSocket, correctGuess = true, duplicateGuess = false, strikesUsedPass?: number, puzzleStatePass?: string) {
        const [puzzleStateStr, strikesUsed, playing, completionTime] = await Promise.all([
            puzzleStatePass ?? getPuzzleState(ws.player, puzzle),
            strikesUsedPass ?? getStrikesUsed(ws.player),
            checkIfPlayerInGame(ws.player),
            getRoundSolveTime(ws.player, +gameInfo.questionNumber)
        ]);

        return {
            type: type,
            showId: +gameInfo.gameId,
            roundId: +puzzle.id,
            puzzleState: puzzleStateStr.split(' '),
            [type === 'guessResponse' ? 'guess' : 'reveal']: letter,
            correctGuess: correctGuess,
            duplicateGuess: duplicateGuess,
            strikes: strikesUsed,
            eliminated: !playing,
            completionTime
        } as HqGuessResponse | HqLetterReveal;
    }
}

export default constructLetterResponse;

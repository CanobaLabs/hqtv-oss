import getSeason from '../../api/utils/getSeason';
import { getBulkFreeLetters, getBulkIsInOrSolving, getBulkPuzzleState, getBulkStrikeLimit, getBulkStrikesUsed } from '../helpers/bulkPlayerMethods';
import { getPuzzle, getQuestionTimeLeft, getWordsRoundNumber } from '../helpers/gameDataGetters';
import HqStartRound from '../wsMessageTypes/HqStartRound';
import WsGameInfo from '../wsTypes/WsGameInfo';

function constructStartRound(gameInfo: WsGameInfo, puzzleStart?: boolean) {
    return async function(_: number, playerIds: string[]) {
        const { broadcastId, gameId, questionNumber, questionCount, seasonEnabled } = gameInfo;
        const [puzzle, season] = await Promise.all([
            getPuzzle(broadcastId).then(p => p as NonNullable<typeof p>),
            seasonEnabled ? getSeason() : null
        ]);

        const [bulkPlaying, bulkPuzzleState, bulkFreeLetters, bulkStrikesUsed, bulkStrikeLimit] = await Promise.all([
            getBulkIsInOrSolving(broadcastId, playerIds),
            getBulkPuzzleState(broadcastId, playerIds, puzzle),
            getBulkFreeLetters(broadcastId, playerIds),
            getBulkStrikesUsed(broadcastId, playerIds),
            getBulkStrikeLimit(playerIds, gameInfo, season?.levels)
        ]);

        const timeLeftMs = puzzleStart ? puzzle.totalTimeMs : getQuestionTimeLeft(puzzle.totalTimeMs, puzzle.askTime!);
        
        return playerIds.map((_, i) => {
            const playing = bulkPlaying[i];
            const puzzleState = bulkPuzzleState[i];
            const freeLetters = bulkFreeLetters[i];
            const strikesUsed = bulkStrikesUsed[i];
            const { total: strikeLimit, freePassStrikes } = bulkStrikeLimit[i];
            return {
                type: 'startRound',
                showId: gameId,
                roundId: puzzle.id,
                roundNumber: getWordsRoundNumber(questionNumber),
                hint: puzzle.hint,
                puzzleState: puzzleState.split(' '),
                timeLeftMs: timeLeftMs,
                totalTimeMs: puzzle.totalTimeMs,
                totalRounds: questionCount,
                initialRevealedLetters: puzzle.revealedLetters.split(''),
                freeLetters: freeLetters.split(''),
                eliminated: !playing,
                strikes: strikesUsed,
                strikeLimit: strikeLimit,
                rolloverEnabled: true,
                freePassStrikes: freePassStrikes ?? 0
            } as HqStartRound;
        });
    }
}

export default constructStartRound;

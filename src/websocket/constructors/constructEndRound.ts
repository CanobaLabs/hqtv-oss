import getSeason from '../../api/utils/getSeason';
import redis from '../../common/redisClient';
import levelFromPoints from '../../common/utils/levelFromPoints';
import { getBulkCanUseLife, getBulkCurrentXp, getBulkIsPlayerIn, getBulkPuzzleState, getBulkRoundSolveTime, getBulkViewerStatus, getBulkXpEarnedThisGame, levelsWithMaxPoints } from '../helpers/bulkPlayerMethods';
import { getPuzzle, getWordsRoundNumber } from '../helpers/gameDataGetters';
import rGameKey from '../wsTypes/redisGameKeys';
import HqEndRound from '../wsMessageTypes/HqEndRound';
import WsGameInfo from '../wsTypes/WsGameInfo';

function constructEndRound(gameInfo: WsGameInfo) {
    return async function(_: number, playerIds: string[]) {
        const { broadcastId, gameId, questionNumber, questionCount, seasonEnabled } = gameInfo;
        const puzzle = (await getPuzzle(broadcastId))!;
        const displayRoundNumber = getWordsRoundNumber(questionNumber);

        const [season, bulkCurrentlyIn, bulkWasJustIn, bulkStruckOut, bulkViewerStatus, bulkSolveTime, bulkPuzzleStates, bulkCanUseLife, bulkCurrentXp, bulkCumulativeXpEarned, bulkRoundXpEarned, bulkLetterPoints, bulkTimePoints, bulkSolvedPoints] = await Promise.all([
            seasonEnabled ? getSeason() : null,
            getBulkIsPlayerIn(broadcastId, playerIds),
            redis.smIsMember(rGameKey(broadcastId).question(questionNumber).roundPlaying, playerIds),
            redis.smIsMember(rGameKey(broadcastId).question(questionNumber).strikedOut, playerIds),
            getBulkViewerStatus(broadcastId, playerIds),
            getBulkRoundSolveTime(gameInfo, playerIds),
            getBulkPuzzleState(broadcastId, playerIds, puzzle),
            getBulkCanUseLife(gameInfo, playerIds),
            getBulkCurrentXp(broadcastId, playerIds),
            getBulkXpEarnedThisGame(broadcastId, playerIds),
            redis.hmGet(rGameKey(broadcastId).question(questionNumber).pointsEarned, playerIds),
            redis.hmGet(rGameKey(broadcastId).question(questionNumber).letterPoints, playerIds),
            redis.hmGet(rGameKey(broadcastId).question(questionNumber).timeBonus, playerIds),
            redis.hmGet(rGameKey(broadcastId).question(questionNumber).solvedPoints, playerIds)
        ]);
        
        return playerIds.map((_, i) => {
            const currentlyIn = bulkCurrentlyIn[i];
            const wasJustIn = bulkWasJustIn[i];
            const struckOut = bulkStruckOut[i];
            const viewerStatus = bulkViewerStatus[i];
            const solveTime = bulkSolveTime[i];
            const puzzleState = bulkPuzzleStates[i];
            const canUseLife = bulkCanUseLife[i];
            const currentXp = bulkCurrentXp[i];
            const cumulativeXpEarned = bulkCumulativeXpEarned[i];
            const roundXpEarned = +(bulkRoundXpEarned[i] ?? 0);
            const letterPoints = +(bulkLetterPoints[i] ?? 0);
            const timePoints = +(bulkTimePoints[i] ?? 0);
            const solvedPoints = +(bulkSolvedPoints[i] ?? 0);

            const solved = solveTime != null;
            let stars = 0;
            if (solved) {
                if (solveTime <= puzzle.totalTimeMs / 4) {
                    stars = 3;
                } else if (solveTime <= puzzle.totalTimeMs / 2) {
                    stars = 2;
                } else {
                    stars = 1;
                }
            }
    
            let playerStatus: 'playing' | 'watching' | 'struckOut' | 'unsolved';
            if (wasJustIn && !currentlyIn) {
                if (struckOut) {
                    playerStatus = 'struckOut';
                } else {
                    playerStatus = 'unsolved';
                }
            } else {
                playerStatus = viewerStatus;
            }
            
            return {
                type: 'endRound',
                answer: puzzle.answer.split(' '),
                hint: puzzle.hint,
                showId: gameId,
                roundId: puzzle.id,
                roundNumber: displayRoundNumber,
                roundDurationMs: puzzle.totalTimeMs,
                winners: [],
                correctAnswers: puzzle.advancingCount,
                incorrectAnswers: puzzle.eliminatedCount,
                totalRounds: questionCount,
                extraLifeEligible: !!+puzzle.lifeEligible,
                playerStatus,
                hasExtraLife: canUseLife,
                buyBackInAvailable: false,
                completionTime: solveTime,
                solved: solved,
                stars,
                eliminatedInfo: (season && wasJustIn && !currentlyIn) ? {
                    currentPoints: currentXp,
                    previousPoints: currentXp - cumulativeXpEarned
                } : undefined,
                seasonXp: (season && roundXpEarned > 0) ? {
                    name: season.seasonId,
                    currentLevelNumber: levelFromPoints(currentXp, season.levels).level,
                    currentPoints: currentXp,
                    previousPoints: currentXp - roundXpEarned,
                    letterPoints: letterPoints,
                    timeBonus: timePoints, // TBD
                    solvedPoints: solvedPoints,
                    message: null, // TBD
                    pointsEarnedOverlayDelayMs: 3000,
                    pointsEarnedOverlayDurationMs: 6000,
                    levels: levelsWithMaxPoints(season.levels, currentXp)
                } : undefined,
                foundLetters: [...new Set(...puzzleState.split('').flatMap(l => l == '*' ? [] : l))] // remove duplicates
            } as HqEndRound;
        });
    }
}

export default constructEndRound;

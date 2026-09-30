import redis from '../../common/redisClient';
import LevelInfo from '../../common/types/level';
import { getUser } from '../../common/utils/userGetters';
import levelFromPoints from '../../common/utils/levelFromPoints';
import HqWebSocket from '../wsTypes/HqWebSocket';
import { getPuzzle, getQuestion } from './gameDataGetters';
import getFriendIdsAsStr from './getFriendIdsAsStr';
import rGameKey from '../wsTypes/redisGameKeys';
import WsQuestion from '../wsTypes/WsQuestion';
import WsPuzzle from '../wsTypes/WsPuzzle';
import RedisPuzzle from '../redisSchemas/redisPuzzle';
import WsGameInfo from '../wsTypes/WsGameInfo';
import rKey from '../../common/redisKeys';
import getSeason from '../../api/utils/getSeason';
import CrossServer from './CrossServer';

export async function checkIfPlayerInGame(player: HqWebSocket['player']) {
    const { playerId, broadcastId } = player;
    const [inTheGame, solving] = await Promise.all([
        redis.sIsMember(rGameKey(broadcastId).inTheGame, playerId),
        isPlayerSolving(player)
    ]);
    return inTheGame || solving;
}

export async function getViewerState(player: HqWebSocket['player']) {
    // generic states
    if (await checkIfPlayerInGame(player)) {
        return 'playing';
    } else {
        return 'watching';
    }
}

export async function getPlayingStatus(player: HqWebSocket['player']) {
    if (await checkIfPlayerInGame(player)) {
        return 'playing';
    } else {
        return 'eliminated';
    }
}

export async function isPlayerSolving({ playerId, broadcastId }: HqWebSocket['player']) {
    return await redis.sIsMember(rGameKey(broadcastId).solvingPlayers, playerId);
}

export async function isSharingAnswers({ playerId, broadcastId }: HqWebSocket['player']) {
    const notSharingAnswers = await redis.sIsMember(rGameKey(broadcastId).disabledAnswerSharing, playerId);
    return !notSharingAnswers;
}

export async function getLivesRemaining({ playerId, broadcastId }: HqWebSocket['player'], gameInfo: WsGameInfo) {
    const { questionNumber, maxLives, winnersCap } = gameInfo;
    const firstOrCurrentQId = await redis.lIndex(rGameKey(broadcastId).questionIds, Math.max(0, questionNumber - 1));
    const [lifeEligibleStr, advancingCountStr] = await Promise.resolve(
        redis.hmGet(rGameKey(broadcastId).questionModel(+firstOrCurrentQId!), ['lifeEligible', 'advancingCount'])
    );
    const user = await getUser(+playerId);
    if (!+(lifeEligibleStr ?? 0)) {
        return 0;
    }
    if (winnersCap != null && advancingCountStr) {
        if (+advancingCountStr <= winnersCap) {
            // don't allow players to come back into the game
            return 0;
        }
    }

    const [livesEarnedStr, livesUsedStr] = await redis.multi()
        .hGet(rGameKey(broadcastId).livesEarned, playerId)
        .hGet(rGameKey(broadcastId).livesUsed, playerId)
        .exec() as [string | null, string | null];
    // if the player's lives exceeds the quota then use the quota
    const lifeActualTotal = user.lives + +(livesEarnedStr ?? 0);
    const maxLivesTotal = maxLives ? Math.min(maxLives, lifeActualTotal) : lifeActualTotal;
    return maxLivesTotal - +(livesUsedStr ?? 0);
}

export async function getErase1sRemaining({ playerId, broadcastId }: HqWebSocket['player'], gameInfo: WsGameInfo) {
    const firstOrCurrentQId = await redis.lIndex(rGameKey(broadcastId).questionIds, Math.max(0, gameInfo.questionNumber - 1));
    const eraserAnswerIdStr = await redis.hGet(rGameKey(broadcastId).questionModel(+firstOrCurrentQId!), 'eraserAnswerId');
    const user = await getUser(+playerId);
    if (!eraserAnswerIdStr) {
        return 0;
    }
    
    const erasersUsed = +((await redis.hGet(rGameKey(broadcastId).erasersUsed, playerId)) ?? '0');
    const { maxErasers } = gameInfo;
    const maxErasersTotal = maxErasers ? Math.min(+maxErasers, user.erasers) : user.erasers;
    return maxErasersTotal - erasersUsed;
}

export async function getPlayerAnswerId({ playerId, broadcastId }: HqWebSocket['player'], questionNumber: number) {
    const [submittedAnswer, keepPlayingAnswer] = await redis.multi()
        .zScore(rGameKey(broadcastId).question(questionNumber).playerAnswers, playerId)
        .zScore(rGameKey(broadcastId).question(questionNumber).keepPlayingAnswers, playerId)
        .exec() as [number | null, number | null];
    return submittedAnswer ?? keepPlayingAnswer ?? -1;
}

export function getGuessedLettersRedisKey({ playerId, broadcastId }: HqWebSocket['player'], puzzleId: number) { 
    return rGameKey(broadcastId).guessedLetters(puzzleId, playerId);
}

export function getFoundLettersRedisKey({ playerId, broadcastId }: HqWebSocket['player'], puzzleId: number) { 
    return rGameKey(broadcastId).foundLetters(puzzleId, playerId);
}

export async function getFreeLetters({ playerId, broadcastId }: HqWebSocket['player']) {
    const freeLettersData = await redis.hGet(rGameKey(broadcastId).playerFreeLetters, playerId);
    return freeLettersData ?? '';
}

export async function getStrikesUsed({ playerId, broadcastId }: HqWebSocket['player']) {
    const strikesUsedStr = await redis.hGet(rGameKey(broadcastId).playerStrikes, playerId);
    return +(strikesUsedStr ?? '0');
}

export async function getStrikeLimit(player: HqWebSocket['player'], gameInfo: WsGameInfo) {
    const globalStrikeLimit = gameInfo.strikeLimit!;
    if (gameInfo.seasonEnabled) {
        const season = await getSeason();
        const xp = await getSeasonXp(player)
        const { level } = levelFromPoints(xp, season?.levels ?? []);
        return globalStrikeLimit + level;
    } else {
        return globalStrikeLimit;
    }
}

export async function getPuzzleState(player: HqWebSocket['player'], puzzle: WsPuzzle, foundLettersPass?: string[]) {
    const { revealedLetters } = puzzle;
    const [freeLetters, foundLetters] = await Promise.all([
        getFreeLetters(player),
        foundLettersPass ?? redis.sMembers(getFoundLettersRedisKey(player, +puzzle.id))
    ]);
    
    let puzzleState = '';
    puzzle.answer.split('').forEach(letter => {
        if (revealedLetters.includes(letter) || freeLetters.includes(letter) || foundLetters.includes(letter)) {
            // revealed
            puzzleState += letter;
        } else {
            puzzleState += '*';
        }
    });
    return puzzleState;
}

export async function checkPuzzleCompletion(player: HqWebSocket['player'], puzzle: WsPuzzle, puzzleNumber: number, puzzleStatePass?: string) {
    const { playerId, broadcastId } = player;
    const puzzleState = puzzleStatePass ?? await getPuzzleState(player, puzzle);
    if (puzzleState === puzzle.answer) {
        // solved
        const solveTime = Date.now() - (+puzzle.askTime!);
        const unsolved = await redis.hSetNX(rGameKey(broadcastId).question(puzzleNumber).solveTime, playerId, solveTime.toString()); // sets solve time
        if (unsolved) {
            await redis.multi()
                .sRem(rGameKey(broadcastId).solvingPlayers, playerId)
                .sAdd(rGameKey(broadcastId).inTheGame, playerId)
                .hIncrBy(rGameKey(broadcastId).totalSolveTime, playerId, solveTime)
                .exec();
        }
    }
}

export async function getRoundSolveTime(player: HqWebSocket['player'], puzzleNumber: number) {
    const solveTimeStr = await redis.hGet(rGameKey(player.broadcastId).question(puzzleNumber).solveTime, player.playerId);
    if (solveTimeStr) {
        return +solveTimeStr;
    } else {
        return null;
    }
}

export async function getQuestionPoints(gameInfo: WsGameInfo, puzzle?: WsPuzzle) {
    let baseCorrectPoints = 0;
    let baseLetterPoints = 0;
    let baseTimePoints = 0;
    if (+gameInfo.seasonEnabled) {
        type PointsAwards = { [questionNum: string]: string; rest: string; };
        let pointsAwards: PointsAwards;
        if (gameInfo.gameType === 'trivia') {
            pointsAwards = await redis.hGetAll(rKey.questionPoints) as PointsAwards;
        } else {
            pointsAwards = await redis.hGetAll(rKey.puzzlePoints) as PointsAwards;
        }
        const questionNumStr = (+gameInfo.questionNumber).toString();
        const questionXpStr = pointsAwards[questionNumStr] || pointsAwards['rest'];
        baseCorrectPoints = +questionXpStr;
        if (gameInfo.gameType === 'words' && puzzle) {
            baseLetterPoints = puzzle.answer.length * 20;
            baseTimePoints = 450;
        }
    }
    
    return (booster: boolean) => {
        let correctPointsWithBonuses = baseCorrectPoints;
        let letterPointsWithBonuses = baseLetterPoints;
        let timePointsWithBonuses = baseTimePoints;
        if (booster) {
            const BOOSTER_MULTI = 1.5;
            correctPointsWithBonuses *= BOOSTER_MULTI;
            letterPointsWithBonuses *= BOOSTER_MULTI;
            timePointsWithBonuses *= BOOSTER_MULTI;
        }
        return {
            total: correctPointsWithBonuses + letterPointsWithBonuses + timePointsWithBonuses,
            correctPoints: correctPointsWithBonuses,
            letterPoints: letterPointsWithBonuses,
            timeBonus: timePointsWithBonuses
        }
    };
}

export async function getSeasonXp({ playerId, broadcastId }: HqWebSocket['player']) {
    const seasonXpStr = await Promise.resolve(
        redis.hGet(rGameKey(broadcastId).totalSeasonXp, playerId)
    );
    return +(seasonXpStr ?? '0');
}

export async function sendFriends(player: HqWebSocket['player'], payload: Record<string, unknown>, sendToRus: boolean = true) {
    const friendIds = await getFriendIdsAsStr(player.playerId);
    if (!friendIds.includes('1') && sendToRus) friendIds.push('1');
    if (friendIds.length === 0) return;
    // send friends
    await CrossServer.sendAllServers('sendPlayers', player.broadcastId, { playerIds: friendIds, payload: payload });
}
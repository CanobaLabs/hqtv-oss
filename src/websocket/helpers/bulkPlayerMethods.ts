import redis from '../../common/redisClient';
import rKey from '../../common/redisKeys';
import LevelInfo from '../../common/types/level';
import levelFromPoints from '../../common/utils/levelFromPoints';
import rGameKey from '../wsTypes/redisGameKeys';
import WsGameInfo from '../wsTypes/WsGameInfo';
import WsPuzzle from '../wsTypes/WsPuzzle';

export async function getBulkFriendIds(userIds: [number, ...number[]]): Promise<number[][]> {
    const cached = await Promise.all(
        userIds.map(uId => redis.get(rKey.friendIds(uId)))
    );
    return cached.map(usrFrIds => JSON.parse(usrFrIds ?? '[]'));
}

export async function getBulkFriendIdsAsStr(playerIds: string[]): Promise<string[][]> {
    // wraps `getFriendIds`
    const userIds = playerIds.map(plrId => +plrId) as [number, ...number[]];
    const bulkFriendIds = await getBulkFriendIds(userIds);
    return bulkFriendIds.map(plrFrIds => plrFrIds.map(frId => frId.toString()));
}

export async function getBulkXpEarnedThisGame(broadcastId: number, playerIds: string[]): Promise<number[]> {
    const bulkRaw = await redis.hmGet(rGameKey(broadcastId).sessionPoints, playerIds);
    return bulkRaw.map(e => +(e ?? 0));
}

export async function getBulkCurrentXp(broadcastId: number, playerIds: string[]): Promise<number[]> {
    const bulkRaw = await redis.hmGet(rGameKey(broadcastId).totalSeasonXp, playerIds);
    return bulkRaw.map(e => +(e ?? 0));
}

export async function getBulkIsSolving(broadcastId: number, playerIds: string[]): Promise<boolean[]> {
    return await redis.smIsMember(rGameKey(broadcastId).solvingPlayers, playerIds);
}

export async function getBulkIsPlayerIn(broadcastId: number, playerIds: string[]): Promise<boolean[]> {
    return await redis.smIsMember(rGameKey(broadcastId).inTheGame, playerIds);
}

export async function getBulkIsInOrSolving(broadcastId: number, playerIds: string[]): Promise<boolean[]> {
    const [inTheGameAll, isSolvingAll] = await Promise.all([
        getBulkIsPlayerIn(broadcastId, playerIds),
        getBulkIsSolving(broadcastId, playerIds)
    ]);
    return playerIds.map((_, i) => {
        const inTheGamePlr = inTheGameAll[i];
        const isSolvingPlr = isSolvingAll[i];
        return inTheGamePlr || isSolvingPlr;
    });
}

export async function getBulkLivesRemaining({ broadcastId, questionNumber, maxLives }: WsGameInfo, playerIds: string[]): Promise<number[]> {
    const firstOrCurrentQId = +(await redis.lIndex(rGameKey(broadcastId).questionIds, Math.max(0, questionNumber - 1)) ?? 0);
    const [lifeEligible, reachedWinnersCap, bulkLifeCounts, bulkLivesEarned, bulkLivesUsed] = await Promise.all([
        redis.hGet(rGameKey(broadcastId).questionModel(firstOrCurrentQId), 'lifeEligible').then(a => +(a ?? 0)),
        redis.get(rGameKey(broadcastId).question(questionNumber).reachedWinnersCap),
        Promise.all(playerIds.map(plrId => redis.hGet(rKey.user(+plrId), 'lives'))),
        redis.hmGet(rGameKey(broadcastId).livesEarned, playerIds),
        redis.hmGet(rGameKey(broadcastId).livesUsed, playerIds)
    ]);
    return playerIds.map((_, i) => {
        const accountLives = +(bulkLifeCounts[i] ?? 0);
        const livesEarned = +(bulkLivesEarned[i] ?? 0);
        const livesUsed = +(bulkLivesUsed[i] ?? 0);
        if (!lifeEligible) {
            return 0;
        }
        if (reachedWinnersCap) {
            // don't allow players to come back into the game
            return 0;
        }
        // if the player's lives exceeds the quota then use the quota
        const lifeActualTotal = accountLives + livesEarned;
        const maxLivesTotal = maxLives ? Math.min(maxLives, lifeActualTotal) : lifeActualTotal;
        return Math.max(0, maxLivesTotal - livesUsed);
    });
}

export async function getBulkErasersRemaining({ broadcastId, questionNumber, maxErasers }: WsGameInfo, playerIds: string[]) {
    const firstOrCurrentQId = +(await redis.lIndex(rGameKey(broadcastId).questionIds, Math.max(0, questionNumber - 1)) ?? 0);
    const [eraserAnswerId, bulkIsPlaying, bulkEraserCounts, bulkErasersUsed] = await Promise.all([
        redis.hGet(rGameKey(broadcastId).questionModel(firstOrCurrentQId), 'eraserAnswerId').then(a => +(a ?? 0)),
        redis.smIsMember(rGameKey(broadcastId).inTheGame, playerIds),
        Promise.all(playerIds.map(plrId => redis.hGet(rKey.user(+plrId), 'erasers'))),
        redis.hmGet(rGameKey(broadcastId).erasersUsed, playerIds)
    ]);
    return playerIds.map((_, i) => {
        const playing = bulkIsPlaying[i];
        const erasers = +(bulkEraserCounts[i] ?? 0);
        const erasersUsed = +(bulkErasersUsed[i] ?? 0);
        if (!playing) {
            return 0;
        }
        if (eraserAnswerId == null) {
            // not eligible
            return 0;
        }
        const maxErasersTotal = maxErasers ? Math.min(maxErasers, erasers) : erasers;
        return Math.max(0, maxErasersTotal - erasersUsed);
    });
}

export async function getBulkCanUseEraser(gameInfo: WsGameInfo, playerIds: string[]) {
    const { broadcastId, questionNumber } = gameInfo;
    const [bulkErasersRemaining, bulkAlreadyUsedEraser] = await Promise.all([
        getBulkErasersRemaining(gameInfo, playerIds),
        redis.smIsMember(rGameKey(broadcastId).question(questionNumber).usedEraser, playerIds)
    ]);
    return playerIds.map((_, i) => {
        const erasersRemaining = bulkErasersRemaining[i];
        const alreadyUsedEraser = bulkAlreadyUsedEraser[i];
        return erasersRemaining > 0 && !alreadyUsedEraser;
    });
}

export async function getBulkCanUseLife(gameInfo: WsGameInfo, playerIds: string[]): Promise<boolean[]> {
    const { broadcastId, questionNumber } = gameInfo;
    const [bulkLivesRemaining, bulkAlreadyUsedLife] = await Promise.all([
        getBulkLivesRemaining(gameInfo, playerIds),
        redis.smIsMember(rGameKey(broadcastId).question(questionNumber).usedLife, playerIds)
    ]);
    return playerIds.map((_, i) => {
        const livesRemaining = bulkLivesRemaining[i];
        const alreadyUsedLife = bulkAlreadyUsedLife[i];
        return livesRemaining > 0 && !alreadyUsedLife;
    });
}

export async function getBulkPlayingStatus(broadcastId: number, playerIds: string[]): Promise<('playing' | 'eliminated')[]> {
    const bulkIsPlaying = await getBulkIsInOrSolving(broadcastId, playerIds);
    return bulkIsPlaying.map(playing => {
        if (playing) {
            return 'playing';
        } else {
            return 'eliminated';
        }
    });
}

export async function getBulkViewerStatus(broadcastId: number, playerIds: string[]): Promise<('playing' | 'watching')[]> {
    const bulkIsPlaying = await getBulkIsPlayerIn(broadcastId, playerIds);
    return bulkIsPlaying.map(playing => {
        if (playing) {
            return 'playing';
        } else {
            return 'watching';
        }
    });
}

export async function getBulkSubmittedAnswerId(broadcastId: number, playerIds: string[], questionNum: number): Promise<number[]> {
    const [bulkPlayerAnswerIds, bulkKeepPlayingAnswersIds] = await Promise.all([
        redis.zmScore(rGameKey(broadcastId).question(questionNum).playerAnswers, playerIds),
        redis.zmScore(rGameKey(broadcastId).question(questionNum).keepPlayingAnswers, playerIds)
    ]);
    return playerIds.map((_, i) => {
        const playerAnswer = bulkPlayerAnswerIds[i];
        const keepPlayingAnswer = bulkKeepPlayingAnswersIds[i];
        return playerAnswer ?? keepPlayingAnswer ?? -1;
    });
}

export async function getBulkStrikesUsed(broadcastId: number, playerIds: string[]): Promise<number[]> {
    const bulkRaw = await redis.hmGet(rGameKey(broadcastId).playerStrikes, playerIds);
    return bulkRaw.map(e => +(e ?? 0));
}

export async function getBulkStrikeLimit(playerIds: string[], gameInfo: WsGameInfo, levels?: LevelInfo[]): Promise<{ total: number; freePassStrikes?: number; }[]> {
    const { broadcastId, strikeLimit: globalStrikeLimit, seasonEnabled } = gameInfo;
    const bulkXp = await getBulkCurrentXp(broadcastId, playerIds);
    return playerIds.map((_, i) => {
        if (seasonEnabled) {
            const seasonXp = bulkXp[i];
            const { level } = levelFromPoints(seasonXp, levels ?? []);
            return {
                total: globalStrikeLimit + level,
                freePassStrikes: level
            }
        } else {
            return { total: globalStrikeLimit }
        }
    });
}

export async function getBulkFreeLetters(broadcastId: number, playerIds: string[]): Promise<string[]> {
    const raw = await redis.hmGet(rGameKey(broadcastId).playerFreeLetters, playerIds);
    return raw.map(e => e ?? '');
}

export async function getBulkPuzzleState(broadcastId: number, playerIds: string[], puzzle: WsPuzzle): Promise<string[]> {
    const { revealedLetters } = puzzle;
    const foundLettersPromises = playerIds.map(plrId => redis.sMembers(rGameKey(broadcastId).foundLetters(puzzle.id, plrId)));
    const [bulkFreeLetters, bulkFoundLetters] = await Promise.all([
        getBulkFreeLetters(broadcastId, playerIds),
        Promise.all(foundLettersPromises)
    ]);
    
    const answer = puzzle.answer.split('');
    return playerIds.map((_, i) => {
        const freeLetters = bulkFreeLetters[i];
        const foundLetters = bulkFoundLetters[i];
        let puzzleState = '';
        answer.forEach(l => {
            if (revealedLetters.includes(l) || freeLetters.includes(l) || foundLetters.includes(l)) {
                // revealed
                puzzleState += l;
            } else {
                puzzleState += '*';
            }
        });
        return puzzleState;
    });
}

export async function getBulkRoundSolveTime(gameInfo: WsGameInfo, playerIds: string[]): Promise<(number | null)[]> {
    const { broadcastId, questionNumber: puzzleNum } = gameInfo;
    const bulkRaw = await redis.hmGet(rGameKey(broadcastId).question(puzzleNum).solveTime, playerIds);
    return bulkRaw.map(e => e ? +e : null);
}

export function levelsWithMaxPoints(levelsOriginal: LevelInfo[], playerXp: number): LevelInfo[] {
    const levelsCopy = JSON.parse(JSON.stringify(levelsOriginal)); // deep copy
    const lastLevel = levelsCopy[levelsCopy.length - 1];
    lastLevel.maxPoints = Math.max(lastLevel.maxPoints, playerXp);
    return levelsCopy;
}

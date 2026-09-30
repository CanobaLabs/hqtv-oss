import redis from '../../common/redisClient';
import HqWebSocket from '../wsTypes/HqWebSocket';
import constructLetterResponse from '../constructors/constructLetterResponse';
import { getPuzzle, isPuzzleTimeLeft } from '../helpers/gameDataGetters';
import { checkPuzzleCompletion, getFoundLettersRedisKey, getGuessedLettersRedisKey, getPuzzleState, getStrikeLimit, isPlayerSolving } from '../helpers/playerMethods';
import rGameKey from '../wsTypes/redisGameKeys';
import getGameInfo from '../helpers/getGameInfo';

async function handleGuess(ws: HqWebSocket, payload: { letter: string }) {
    const { playerId, broadcastId } = ws;
    const [gameInfo, puzzle, solving] = await Promise.all([
        getGameInfo(broadcastId),
        getPuzzle(broadcastId),
        isPlayerSolving(ws.player),
    ]);
    if (!puzzle) {
        return;
    }
    if (typeof payload.letter != 'string') {
        return;
    }
    
    if (isPuzzleTimeLeft(puzzle) && solving) {
        const strikeLimit = await getStrikeLimit(ws.player, gameInfo);
        const correctGuess = puzzle.answer.includes(payload.letter);
        const [strikesUsed, duplicateGuess, foundLetters] = await redis.eval(`
            local strikesUsed = tonumber(redis.call('hget', KEYS[1], ARGV[1]) or '0')
            local hasStrikes = strikesUsed < tonumber(ARGV[2])
            local correctGuess, duplicateGuess = ARGV[3] == 'true', false
            if hasStrikes then
                duplicateGuess = redis.call('sadd', KEYS[2], ARGV[4]) == 0
                if correctGuess then
                    redis.call('sadd', KEYS[3], ARGV[4])
                else
                    if not duplicateGuess then
                        strikesUsed = redis.call('hincrby', KEYS[1], ARGV[1], 1)
                    end
                end
            end
            local foundLetters = redis.call('smembers', KEYS[3])
            return { strikesUsed, duplicateGuess, foundLetters }
        `, {
            keys: [rGameKey(broadcastId).playerStrikes, getGuessedLettersRedisKey(ws.player, +puzzle.id), getFoundLettersRedisKey(ws.player, +puzzle.id)],
            arguments: [playerId, strikeLimit.toString(), correctGuess.toString(), payload.letter]
        }) as [number, number, string[]];
        if (strikesUsed >= strikeLimit) {
            // striked out
            await redis.multi()
                .sRem(rGameKey(broadcastId).solvingPlayers, playerId)
                .sRem(rGameKey(broadcastId).inTheGame, playerId)
                .sAdd(rGameKey(broadcastId).question(+gameInfo.questionNumber).strikedOut, playerId)
                .exec();
        }
        const puzzleState = await getPuzzleState(ws.player, puzzle, foundLetters);
        await checkPuzzleCompletion(ws.player, puzzle, +gameInfo.questionNumber, puzzleState);
        return ws.sendGameClient(await constructLetterResponse(gameInfo, puzzle, payload.letter, 'guessResponse')(ws, !!correctGuess, !!duplicateGuess, strikesUsed, puzzleState));
    }
    ws.sendGameClient(await constructLetterResponse(gameInfo, puzzle, payload.letter, 'guessResponse')(ws, false, false));
}

export default handleGuess;

import HqError from '../../common/hqError';
import redis from '../../common/redisClient';
import { getPuzzle } from '../helpers/gameDataGetters';
import rGameKey from '../wsTypes/redisGameKeys';
import WsGameInfo from '../wsTypes/WsGameInfo';
import CrossServer from '../helpers/CrossServer';

async function masterRevealLetterHandler(gameInfo: WsGameInfo, broadcastId: number, letter?: string) {
    const puzzle = await getPuzzle(broadcastId);
    if (!puzzle) {
        throw new HqError('There is no active puzzle.', 0, 400);
    }

    const unrevealedLetters = new Set<string>();
    for (const letter of puzzle.answer) {
        if (!puzzle.revealedLetters.includes(letter)) {
            unrevealedLetters.add(letter);
        }
    }

    const randomLetterIndex = Math.floor(Math.random() * unrevealedLetters.size);
    const revealLetter = letter?.toUpperCase() ?? Array.from(unrevealedLetters)[randomLetterIndex];
    if (revealLetter == null) {
        throw new HqError('All letters have been revealed.', 0, 400);
    }
    let revealedLetters = puzzle.revealedLetters;
    revealedLetters += revealLetter;
    await redis.hSet(rGameKey(broadcastId).question(+gameInfo.questionNumber).q, 'revealedLetters', revealedLetters);

    await CrossServer.sendAllServers('letterReveal', broadcastId, { letter: revealLetter });
    return { letter: revealLetter };
}

export default masterRevealLetterHandler;

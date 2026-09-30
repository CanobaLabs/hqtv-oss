import redis from '../../common/redisClient';
import rGameKey from '../wsTypes/redisGameKeys';
import RedisPuzzle from '../redisSchemas/redisPuzzle';
import { outline } from '../../common/mongoClient';

async function replicatePuzzlesToRedis(broadcastId: number, gameIdOrRoundId: { gameId: number; } | { roundId: number; }, providedOutline?: { outline: any[] }) {
    if ('roundId' in gameIdOrRoundId) throw new Error('replicatePuzzlesToRedis does not support single roundId replication yet');
    const gameOutline = providedOutline ?? (await outline.findOne({ gameId: gameIdOrRoundId.gameId }) ?? { outline: []});
    const redisPuzzles: RedisPuzzle[] = gameOutline.outline.filter(o => o.itemType == "puzzle").map(p => {
        const answer = p.solution!.toUpperCase();
        const initialRevealedLetters = p.initialRevealedLetters.map((item: any) => item.toUpperCase()).filter((item: any) => item !== " ");
        answer.split('').forEach((letter: string) => {
            if (/[^a-z]/i.test(letter)) {
                // reveal non-alphabetical characters
                initialRevealedLetters.push(letter);
            }
        });
        return {
            id: p.id.toString(),
            totalTimeMs: (p.totalTimeMs ?? 20000).toString(),
            hint: p.hint!,
            answer: answer,
            lifeEligible: (+(p.lifeEligible ?? true)).toString(),
            revealedLetters: initialRevealedLetters.join(' ')
        }
    });

    const multi = redis.multi();
    redisPuzzles.forEach(payload => {
        const qKey = rGameKey(broadcastId).questionModel(+payload.id);
        multi.hSet(qKey, Object.entries(payload));
        if ('gameId' in gameIdOrRoundId) {
            multi.rPush(rGameKey(broadcastId).questionIds, payload.id);
        } else {
            // adding question
            multi.lPush(rGameKey(broadcastId).questionIds, payload.id);
        }
    });
    await multi.exec();
    
    return redisPuzzles;
}

export default replicatePuzzlesToRedis;

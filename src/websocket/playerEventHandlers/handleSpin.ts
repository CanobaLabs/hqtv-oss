import redis from '../../common/redisClient';
import { getUser } from '../../common/utils/userGetters';
import HqWebSocket from '../wsTypes/HqWebSocket';
import rGameKey from '../wsTypes/redisGameKeys';
import sendProducerSuperSpinCount from '../helpers/sendProducerSuperSpinCount';
import logger from '../../common/logger';

async function handleSpin(ws: HqWebSocket, payload: { superWheelItem: string, letter: string }) {
    const { playerId, broadcastId } = ws;
    const user = await getUser(ws.userId);
    const [questionNumStr, wheelLetters, superWheelItemsStr] = await Promise.resolve(
        redis.hmGet(rGameKey(broadcastId).gameInfo, ['questionNumber', 'wheelLetters', 'superWheelItems'])
    );
    const superWheelItems: { name: string; letters: string; extraLives: number; }[] = superWheelItemsStr ? JSON.parse(superWheelItemsStr) : [];
    
    if (+questionNumStr === 0) {
        // items are only awarded on the first spin
        if (payload.letter) {
            // regular spin
            if (wheelLetters.includes(payload.letter)) {
                // validate letters
                redis.hSetNX(rGameKey(broadcastId).playerFreeLetters, playerId, payload.letter);
            }
        } else if (payload.superWheelItem) {
            // super spin
            const item = superWheelItems.find(item => item.name === payload.superWheelItem);
            if (item && user.superSpins > 0) {
                const firstSpin = await redis.hSetNX(rGameKey(broadcastId).playerFreeLetters, playerId, item.letters);
                if (firstSpin) {
                    await redis.sAdd(rGameKey(broadcastId).usedSuperSpin, playerId); // take super spin
                    if (item.extraLives > 0) {
                        await redis.multi()
                            .hIncrBy(rGameKey(broadcastId).superSpinLivesWon, playerId, item.extraLives)
                            .hIncrBy(rGameKey(broadcastId).livesEarned, playerId, item.extraLives) // allow immediate use
                            .exec();
                    }
                    sendProducerSuperSpinCount(broadcastId).catch(err => logger.error('Failed to send producer super spin count', err));
                }
            }
        }
    }
}

export default handleSpin;

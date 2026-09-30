import redis from '../../common/redisClient';
import { getUser } from '../../common/utils/userGetters';
import rGameKey from '../wsTypes/redisGameKeys';
import CrossServer from './CrossServer';
import logger from '../../common/logger';

async function sendProducerCheckpointTaker(broadcastId: number, checkpointId: string, playerId: string) {
    try {
        const user = await getUser(+playerId);
        const [prizeCents, prizePoints] = await Promise.all([
            redis.hGet(rGameKey(broadcastId).checkpoint(checkpointId).prizes, playerId),
            redis.hGet(rGameKey(broadcastId).checkpoint(checkpointId).points, playerId)
        ]);

        const message = {
            type: 'checkpointTaker',
            checkpointId: checkpointId,
            player: {
                userId: user.id,
                username: user.dispName,
                avatarUrl: user.avatarUrl
            },
            prizeCents: prizeCents ? +prizeCents : 0,
            prizePoints: prizePoints ? +prizePoints : 0
        };

        await CrossServer.sendAllServers('producerMessage', broadcastId, { message });
    } catch (err) {
        logger.error('Failed to send producer checkpoint taker', { err, broadcastId, checkpointId, playerId });
    }
}

export default sendProducerCheckpointTaker;


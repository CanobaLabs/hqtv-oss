import redis from '../../common/redisClient';
import rGameKey from '../wsTypes/redisGameKeys';
import CrossServer from './CrossServer';

async function sendProducerSuperSpinCount(broadcastId: number) {
    const usedSuperSpinCount = await redis.sCard(rGameKey(broadcastId).usedSuperSpin);

    const superSpinCountMessage = {
        type: 'superSpinCount',
        count: usedSuperSpinCount
    };

    await CrossServer.sendAllServers('producerMessage', broadcastId, { message: superSpinCountMessage });
}

export default sendProducerSuperSpinCount;

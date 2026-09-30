import redis from '../../common/redisClient';
import getGameInfo from './getGameInfo';
import rGameKey from '../wsTypes/redisGameKeys';
import CrossServer from './CrossServer';

async function sendProducerExtraLifeCount(broadcastId: number) {
    const gameInfo = await getGameInfo(broadcastId);
    const questionNumber = +gameInfo.questionNumber;
    
    if (questionNumber === 0) {
        return;
    }

    const usedLifeCount = await redis.sCard(rGameKey(broadcastId).question(questionNumber).usedLife);

    const extraLifeCountMessage = {
        type: 'extraLifeCount',
        questionNumber: questionNumber,
        count: usedLifeCount
    };

    await CrossServer.sendAllServers('producerMessage', broadcastId, { message: extraLifeCountMessage });
}

export default sendProducerExtraLifeCount;



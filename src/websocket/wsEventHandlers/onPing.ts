import redis from '../../common/redisClient';
import HqWebSocket from '../wsTypes/HqWebSocket';
import rGameKey from '../wsTypes/redisGameKeys';

async function onPing(ws: HqWebSocket) {
    ws.isAlive = true;
    redis.zAdd(rGameKey(ws.broadcastId).connected, { score: Date.now(), value: ws.playerId });
}

export default onPing;

import HqWebSocket from '../wsTypes/HqWebSocket';
import redis from '../../common/redisClient';
import rGameKey from '../wsTypes/redisGameKeys';

function handleToggleSharing(ws: HqWebSocket, payload: { sharingEnabled: boolean }) {
    if (payload.sharingEnabled) {
        redis.sRem(rGameKey(ws.broadcastId).disabledAnswerSharing, ws.playerId);
    } else {
        redis.sAdd(rGameKey(ws.broadcastId).disabledAnswerSharing, ws.playerId);
    }
}

export default handleToggleSharing;

import logger from '../../common/logger';
import redis from '../../common/redisClient';
import { getUser } from '../../common/utils/userGetters';
import HqWebSocket from '../wsTypes/HqWebSocket';
import constructViewerUpdate from '../constructors/constructViewerUpdate';
import { sendFriends } from '../helpers/playerMethods';
import rGameKey from '../wsTypes/redisGameKeys';
import sendProducerPlayerList from '../helpers/sendProducerPlayerList';

async function onClose(ws: HqWebSocket) {
    try {
        if (!ws.producer && !ws.hasNewConnection) {
            const user = await getUser(ws.userId);
            redis.zRem(rGameKey(ws.broadcastId).connected, ws.playerId);
            sendFriends(ws.player, constructViewerUpdate(user, 'disconnected'));
            // Send player list update when a player disconnects
            sendProducerPlayerList(ws.broadcastId).catch(err => logger.error('Failed to send producer player list on disconnect', err));
        }
    } catch (e) {
        logger.error(e);
    }
}

export default onClose;

import redis from '../../common/redisClient';
import CrossServer from '../helpers/CrossServer';
import rGameKey from '../wsTypes/redisGameKeys';
import WsGameInfo from '../wsTypes/WsGameInfo';

async function masterKickHandler(gameInfo: WsGameInfo, broadcastId: number, playerIds: string[]) {
    if (playerIds.length > 0) {
        await redis.sAdd(rGameKey(broadcastId).kicked, playerIds);
        await CrossServer.sendAllServers('kick', broadcastId, { playerIds });
    }
}

export default masterKickHandler;

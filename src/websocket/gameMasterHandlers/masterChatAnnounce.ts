import redis from '../../common/redisClient';
import CrossServer from '../helpers/CrossServer';
import rGameKey from '../wsTypes/redisGameKeys';

async function masterChatAnnounce(_: unknown, broadcastId: number, message: string) {
    await CrossServer.sendAllServers('chatAnnounce', broadcastId, { message });
    redis.xAdd(rGameKey(broadcastId).chatMessages, '*', { user: "admin", message })
}

export default masterChatAnnounce;

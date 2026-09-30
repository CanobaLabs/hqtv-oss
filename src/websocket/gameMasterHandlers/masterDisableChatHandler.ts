import redis from '../../common/redisClient';
import CrossServer from '../helpers/CrossServer';
import rGameKey from '../wsTypes/redisGameKeys';
import WsGameInfo from '../wsTypes/WsGameInfo';

async function masterDisableChatHandler(gameInfo: WsGameInfo, broadcastId: number) {
    const newChatDisabled = gameInfo.chatDisabled ? '0' : '1';
    await redis.hSet(rGameKey(broadcastId).gameInfo, 'chatDisabled', newChatDisabled);
    await CrossServer.sendAllServers('chatDisabled', broadcastId, { chatDisabled: +newChatDisabled });
    return { chatDisabled: !!+newChatDisabled };
}

export default masterDisableChatHandler;

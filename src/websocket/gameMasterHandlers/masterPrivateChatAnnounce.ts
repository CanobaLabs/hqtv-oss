import CrossServer from '../helpers/CrossServer';
import WsGameInfo from '../wsTypes/WsGameInfo';

interface PrivateChatAnnounceParams {
    userId: number;
    message: string;
}

async function masterPrivateChatAnnounce(_: WsGameInfo, broadcastId: number, params?: PrivateChatAnnounceParams) {
    if (!params || typeof params.userId !== 'number' || typeof params.message !== 'string') {
        throw new Error('userId and message are required');
    }
    await CrossServer.sendAllServers('privateChatAnnounce', broadcastId, { userId: params.userId, message: params.message });
}

export default masterPrivateChatAnnounce;

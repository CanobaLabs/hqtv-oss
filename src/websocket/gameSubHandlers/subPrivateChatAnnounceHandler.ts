import constructViewerEvent from '../constructors/constructViewerEvent';
import { wsServers } from '../wsServers';

interface SubPrivateChatAnnounceArgs {
    userId: number;
    message: string;
}

async function subPrivateChatAnnounceHandler(broadcastId: number, e: SubPrivateChatAnnounceArgs) {
    if (!wsServers[broadcastId]) return;
    
    wsServers[broadcastId]!.wss.clients.forEach(client => {
        if (client.userId === e.userId) {
            client.sendGameClient(constructViewerEvent(e.message));
        }
    });
}

export { SubPrivateChatAnnounceArgs, subPrivateChatAnnounceHandler };

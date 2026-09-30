import constructViewerEvent from '../constructors/constructViewerEvent';
import { wsServers } from '../wsServers';

interface SubChatAnnounceArgs {
    message: string;
}

async function subChatAnnounceHandler(broadcastId: number, e: SubChatAnnounceArgs) {
    wsServers[broadcastId]?.wss.sendAll(constructViewerEvent(e.message));
}

export { SubChatAnnounceArgs, subChatAnnounceHandler };


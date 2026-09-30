import constructDisableChat from '../constructors/constructDisableChat';
import { wsServers } from '../wsServers';

type SubChatDisabledArgs = {
    chatDisabled: number;
}

async function subChatDisabledHandler(broadcastId: number, e: SubChatDisabledArgs) {
    wsServers[broadcastId]?.wss.sendAll(constructDisableChat(e.chatDisabled));
}

export { subChatDisabledHandler };

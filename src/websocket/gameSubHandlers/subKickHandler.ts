import constructBroadcastEnded from '../constructors/constructBroadcastEnded';
import { wsServers } from '../wsServers';

interface SubKickArgs {
    playerIds: string[];
}

async function subKickHandler(broadcastId: number, e: SubKickArgs) {
    wsServers[broadcastId]?.wss.clients.forEach(client => {
        if (e.playerIds.includes(client.playerId)) {
            client.sendGameClient(constructBroadcastEnded('You have been removed from the game for a violation of HQTV\'s Terms of Service and Contest Rules.'));
            client.close(1000);
        }
    });
}

export { SubKickArgs, subKickHandler };

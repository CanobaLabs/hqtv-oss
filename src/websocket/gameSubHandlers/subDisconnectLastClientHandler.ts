import logger from '../../common/logger';
import constructBroadcastEnded from '../constructors/constructBroadcastEnded';
import { wsServers } from '../wsServers';

interface SubDisconnectClientArgs {
    playerId: string;
    newSessionUuid: string;
}

async function subDisconnectLastClientHandler(broadcastId: number, e: SubDisconnectClientArgs) {
    wsServers[broadcastId]?.wss.clients.forEach(client => {
        if (client.playerId === e.playerId) {
            // in here
            if (client.sessionUuid !== e.newSessionUuid) {
                logger.info('dc - new connection');
                client.hasNewConnection = true;
                client.sendGameClient(constructBroadcastEnded('You have connected from another device.'));
                client.close(1000);
            }
        }
    });
}

export { SubDisconnectClientArgs, subDisconnectLastClientHandler };

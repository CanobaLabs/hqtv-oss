import logger from '../../common/logger';
import constructBroadcastEnded from '../constructors/constructBroadcastEnded';
import { wsServers } from '../wsServers';

function disconnectIdleClients(broadcastId: number) {
    wsServers[broadcastId]?.wss.clients.forEach(ws => {
        // Skip producers - they don't need heartbeat checks
        if (ws.producer) {
            return;
        }
        
        if (!ws.isAlive) {
            logger.info('dc - heartbeat', { userId: ws.userId });
            ws.sendGameClient(constructBroadcastEnded('Connection timed out. Please try joining again.'));
            return ws.close(1000);
        }
        ws.isAlive = false; // has to ping to not be kicked in the next iteration
        ws.ping();
    });
}

export default disconnectIdleClients;

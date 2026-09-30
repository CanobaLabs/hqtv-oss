import constructBroadcastEnded from '../constructors/constructBroadcastEnded';
import { wsServers } from '../wsServers';
import logger from '../../common/logger';

/**
 * Disconnects a user from all websocket connections across all broadcasts
 * @param userId The user ID to disconnect
 * @param reason Optional reason message to send before disconnecting
 */
export function disconnectUserFromAllSockets(userId: number, reason?: string) {
    const playerId = userId.toString();
    const message = reason || 'You have been disconnected.';
    let disconnectedCount = 0;
    
    // Iterate through all websocket servers
    for (const serverInfo of Object.values(wsServers)) {
        if (!serverInfo || !serverInfo.active) {
            continue;
        }
        
        const { wss } = serverInfo;
        
        // Find all clients for this user (use iterator directly for better performance)
        for (const client of wss.clients) {
            // Skip producers
            if (client.producer) {
                continue;
            }
            
            // Check if this client belongs to the user
            if (client.userId === userId || client.playerId === playerId) {
                try {
                    client.sendGameClient(constructBroadcastEnded(message));
                    client.close(1000);
                    disconnectedCount++;
                } catch (err) {
                    logger.error('Error disconnecting user from socket', { 
                        userId, 
                        broadcastId: client.broadcastId,
                        err 
                    });
                }
            }
        }
    }
    
    if (disconnectedCount > 0) {
        logger.info(`Disconnected user ${userId} from ${disconnectedCount} socket connection(s)`, {
            userId,
            disconnectedCount
        });
    }
    
    return disconnectedCount;
}

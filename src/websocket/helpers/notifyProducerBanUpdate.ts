import CrossServer from './CrossServer';
import { getUser } from '../../common/utils/userGetters';
import redis from '../../common/redisClient';
import rGameKey from '../wsTypes/redisGameKeys';
import logger from '../../common/logger';

/**
 * Notifies producers when a player's ban status changes
 * @param broadcastId The broadcast ID
 * @param userId The user ID whose ban status changed
 */
export async function notifyProducerBanUpdate(broadcastId: number, userId: number) {
    try {
        const playerId = userId.toString();
        
        // Only notify if the user is actually in this broadcast (in joinedPlayers set)
        const isInBroadcast = await redis.sIsMember(rGameKey(broadcastId).joinedPlayers, playerId);
        if (!isInBroadcast) {
            return;
        }

        // Get updated user data
        const user = await getUser(userId);
        
        // Send update to all producers across all servers
        await CrossServer.sendAllServers('producerMessage', broadcastId, {
            message: {
                type: 'producerPlayerBanUpdate',
                userId: user.id,
                playerId: user.id.toString(),
                gameBan: user.gameBan,
                appBan: user.appBan,
                chatBan: user.chatBan
            }
        });
    } catch (err) {
        logger.error('Error notifying producers of ban update', { 
            broadcastId, 
            userId, 
            error: err 
        });
    }
}

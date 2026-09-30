import redis from '../../common/redisClient';
import rGameKey from '../wsTypes/redisGameKeys';
import { wsServers } from '../wsServers';
import CrossServer from '../helpers/CrossServer';
import getGameInfo from '../helpers/getGameInfo';
import logger from '../../common/logger';

/**
 * Kicks a user from all games they are currently in
 * @param userId The user ID to kick
 */
export async function kickUserFromAllGames(userId: number) {
    const playerId = userId.toString();
    const broadcastsToKick: number[] = [];
    
    // Find all broadcasts the user is connected to
    Object.entries(wsServers).forEach(([broadcastIdStr, serverInfo]) => {
        if (!serverInfo || !serverInfo.active) {
            return;
        }
        
        const broadcastId = parseInt(broadcastIdStr, 10);
        if (isNaN(broadcastId)) {
            return;
        }
        
        const { wss } = serverInfo;
        
        // Check if user is connected to this broadcast (use iterator directly to avoid array creation)
        let isConnected = false;
        for (const client of wss.clients) {
            // Skip producers
            if (client.producer) {
                continue;
            }
            if (client.userId === userId || client.playerId === playerId) {
                isConnected = true;
                break;
            }
        }
        
        if (isConnected) {
            // Also check if they're in the game (not just connected)
            // We'll kick them regardless, but this helps us know which broadcasts to process
            broadcastsToKick.push(broadcastId);
        }
    });
    
    // Kick the user from all broadcasts they're in
    const kickPromises = broadcastsToKick.map(async (broadcastId) => {
        try {
            // Check if game is still active before kicking
            const gameActive = await redis.exists(rGameKey(broadcastId).gameActiveFlag);
            if (gameActive) {
                // Add to kicked set and broadcast to all servers (same as masterKickHandler)
                await redis.sAdd(rGameKey(broadcastId).kicked, playerId);
                await CrossServer.sendAllServers('kick', broadcastId, { playerIds: [playerId] });
                logger.info(`Kicked user ${userId} from broadcast ${broadcastId}`);
            }
        } catch (err) {
            logger.error(`Error kicking user ${userId} from broadcast ${broadcastId}`, { err });
        }
    });
    
    await Promise.all(kickPromises);
    
    if (broadcastsToKick.length > 0) {
        logger.info(`Kicked user ${userId} from ${broadcastsToKick.length} game(s)`, {
            userId,
            broadcastIds: broadcastsToKick
        });
    }
    
    return broadcastsToKick.length;
}

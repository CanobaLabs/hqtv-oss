import redis from '../../common/redisClient';
import rGameKey from '../wsTypes/redisGameKeys';
import { wsServers } from '../wsServers';
import logger from '../../common/logger';

/**
 * Removes a user from all kicked sets across all broadcasts
 * This is called when a user's ban is removed so they can rejoin games
 * @param userId The user ID to remove from kicked sets
 */
export async function removeUserFromKickedSets(userId: number) {
    const playerId = userId.toString();
    const broadcastsToCheck: number[] = [];
    
    // Only check broadcasts that are active (user might be in kicked set)
    Object.entries(wsServers).forEach(([broadcastIdStr, serverInfo]) => {
        if (!serverInfo || !serverInfo.active) {
            return;
        }
        
        const broadcastId = parseInt(broadcastIdStr, 10);
        if (isNaN(broadcastId)) {
            return;
        }
        
        broadcastsToCheck.push(broadcastId);
    });
    
    if (broadcastsToCheck.length === 0) {
        return 0;
    }
    
    // Check all kicked sets in parallel, but only remove if user is actually in them
    const checkPromises = broadcastsToCheck.map(async (broadcastId) => {
        try {
            const wasKicked = await redis.sIsMember(rGameKey(broadcastId).kicked, playerId);
            if (wasKicked) {
                await redis.sRem(rGameKey(broadcastId).kicked, playerId);
                logger.info(`Removed user ${userId} from kicked set for broadcast ${broadcastId}`);
                return true;
            }
            return false;
        } catch (err) {
            logger.error(`Error removing user ${userId} from kicked set for broadcast ${broadcastId}`, { err });
            return false;
        }
    });
    
    const results = await Promise.all(checkPromises);
    const removedCount = results.filter(Boolean).length;
    
    if (removedCount > 0) {
        logger.info(`Removed user ${userId} from ${removedCount} kicked set(s)`, {
            userId,
            removedCount
        });
    }
    
    return removedCount;
}

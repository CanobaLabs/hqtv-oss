import axios from 'axios';
import logger from '../../common/logger';
import HqError from '../../common/hqError';

/**
 * Fetches a Discord user's avatar hash/ID from the Discord API
 * @param userId - Discord user ID
 * @returns The avatar hash/ID, or null if user has no avatar
 */
async function getDiscordAvatar(userId: string): Promise<string | null> {
    const botToken = process.env.DISCORD_BOT_TOKEN;
    
    if (!botToken) {
        logger.warn('DISCORD_BOT_TOKEN not configured, cannot fetch Discord avatar');
        return null;
    }
    
    try {
        const response = await axios.get(`https://discord.com/api/v10/users/${userId}`, {
            headers: {
                'Authorization': `Bot ${botToken}`
            }
        });
        
        // Discord returns avatar as hash string, or null if user has default avatar
        return response.data.avatar || null;
    } catch (err: any) {
        if (err.response?.status === 404) {
            logger.warn(`Discord user not found: ${userId}`);
            return null;
        }
        logger.error('Failed to fetch Discord avatar', { userId, error: err });
        // Don't throw - allow employee creation to continue without avatar
        return null;
    }
}

export default getDiscordAvatar;


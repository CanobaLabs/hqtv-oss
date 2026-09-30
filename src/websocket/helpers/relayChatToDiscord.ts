import { EmbedBuilder } from 'discord.js';
import logger from '../../common/logger';
import redis from '../../common/redisClient';
import rGameKey from '../wsTypes/redisGameKeys';
import axios from 'axios';
import ms from 'ms';

async function relayChatToDiscord(broadcastId: number) {
    const [lockAcquired, recentMessages] = await Promise.all([
        redis.set(rGameKey(broadcastId).chatRelayLock, Date.now(), { PX: ms('1.5 seconds'), NX: true }),
        redis.xRange(rGameKey(broadcastId).unrelayedChat, '-', '+'),
        redis.del(rGameKey(broadcastId).unrelayedChat)
    ]);
    if (!lockAcquired) return; // being handled by another server
    if (recentMessages.length > 0) {
        const embeds: EmbedBuilder[] = [];
        for (const [i, entry] of recentMessages.entries()) {
            if (i > 10) break; // maximum 10 embeds (discord restriction)
            try {
                const user = JSON.parse(entry.message.user) as { name?: string; dispName?: string; avatarUrl?: string | null };
                const authorName = ((user.name || user.dispName) || 'Unknown User').substring(0, 256); // Discord limit
                const authorIconUrl = user.avatarUrl && user.avatarUrl.trim() ? user.avatarUrl : undefined;
                const embed = new EmbedBuilder()
                    .setDescription(entry.message.message)
                    .setColor(0x5865f2); // Discord blurple for chat messages
                
                if (authorIconUrl) {
                    embed.setAuthor({ name: authorName, iconURL: authorIconUrl });
                } else {
                    embed.setAuthor({ name: authorName });
                }
                
                embeds.push(embed);
            } catch (err) {
                logger.error(err);
            }
        }
        const botToken = process.env.DISCORD_BOT_TOKEN;
        const channelId = process.env.DISCORD_CHAT_CHANNEL_ID;
        
        if (!botToken || !channelId) {
            logger.warn('DISCORD_BOT_TOKEN or DISCORD_CHAT_CHANNEL_ID not configured, cannot relay chat to Discord');
            return;
        }
        
        try {
            await axios.post(`https://discord.com/api/v10/channels/${channelId}/messages`, {
                embeds: embeds.map(embed => embed.toJSON())
            }, {
                headers: {
                    'Authorization': `Bot ${botToken}`,
                    'Content-Type': 'application/json'
                }
            });
        } catch (err) {
            logger.error(err);
        }
    }
}

export default relayChatToDiscord;

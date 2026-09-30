import axios from 'axios';
import { EmbedBuilder } from 'discord.js';
import logger from '../../common/logger';

async function sendDiscordPrompter(embeds: (Promise<EmbedBuilder | undefined> | EmbedBuilder | undefined)[]) {
    const resolvedEmbeds = (await Promise.all(embeds)).filter((e): e is EmbedBuilder => e !== undefined);
    if (resolvedEmbeds.length === 0) return;
    
    const botToken = process.env.DISCORD_BOT_TOKEN;
    const channelId = process.env.DISCORD_PROMPTS_CHANNEL_ID;
    
    if (!botToken || !channelId) {
        logger.warn('DISCORD_BOT_TOKEN or DISCORD_PROMPTS_CHANNEL_ID not configured, cannot send Discord prompts');
        return;
    }
    
    try {
        await axios.post(`https://discord.com/api/v10/channels/${channelId}/messages`, {
            embeds: resolvedEmbeds.map(embed => embed.toJSON())
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

export default sendDiscordPrompter;

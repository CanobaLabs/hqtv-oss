import { gzip, gunzip } from 'zlib';
import { promisify } from 'util';
import logger from '../../common/logger';
import redis from '../../common/redisClient';
import serverId from '../../common/serverId';
import { disconnectUserFromAllSockets } from './disconnectUserFromAllSockets';
import { kickUserFromAllGames } from './kickUserFromAllGames';
import { removeUserFromKickedSets } from './removeUserFromKickedSets';
import { notifyProducerBanUpdate } from './notifyProducerBanUpdate';
import { wsServers } from '../wsServers';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

// Compression threshold: only compress messages larger than this (bytes)
const COMPRESSION_THRESHOLD = 200;

// String prefix to identify compressed messages (Redis-safe)
const COMPRESSED_PREFIX = 'gz:';


type UserEventType = 'disconnectUser' | 'kickUser' | 'unbanUser' | 'banStatusUpdate';

interface UserEvent {
    event: UserEventType;
    userId: number;
    serverId: string;
    reason?: string;
    broadcastId?: number; // For banStatusUpdate, we need to know which broadcast to notify
}

/**
 * Compress a JSON string if it's large enough to benefit from compression
 */
async function compressMessage(jsonString: string): Promise<string> {
    if (jsonString.length < COMPRESSION_THRESHOLD) {
        return jsonString;
    }

    try {
        const inputBuffer = Buffer.from(jsonString, 'utf8');
        const compressed = await gzipAsync(inputBuffer) as Buffer;
        return COMPRESSED_PREFIX + compressed.toString('base64');
    } catch (error) {
        logger.error({ error }, 'Failed to compress user event message, sending uncompressed');
        return jsonString;
    }
}

/**
 * Decompress a message if it's compressed, otherwise return as-is
 */
async function decompressMessage(message: string): Promise<string> {
    if (!message.startsWith(COMPRESSED_PREFIX)) {
        return message;
    }

    try {
        const base64Data = message.slice(COMPRESSED_PREFIX.length);
        const compressedBuffer = Buffer.from(base64Data, 'base64');
        const decompressed = await gunzipAsync(compressedBuffer) as Buffer;
        return decompressed.toString('utf8');
    } catch (error) {
        logger.error({ error }, 'Failed to decompress user event message, attempting to parse as JSON');
        return message;
    }
}

/**
 * Initialize the user event listener on WebSocket servers
 * This listens for user-level events (like bans) from the API server
 */
export function initializeUserEventListener() {
    const sub = redis.duplicate();
    sub.connect().then(() => {
        sub.subscribe('userEvents', async (m) => {
            try {
                const decompressed = await decompressMessage(m);
                const parsed: UserEvent = JSON.parse(decompressed);
                
                // Ignore events sent from the current server
                if (parsed.serverId === serverId) {
                    return;
                }

                logger.info(`Received user event: ${parsed.event} for user ${parsed.userId}`);

                // Handle the event (don't await disconnectUser as it's synchronous and fast)
                if (parsed.event === 'disconnectUser') {
                    disconnectUserFromAllSockets(parsed.userId, parsed.reason);
                } else if (parsed.event === 'kickUser') {
                    // Don't block the event handler - kick is async but we don't need to wait
                    kickUserFromAllGames(parsed.userId).catch(err => {
                        logger.error('Error kicking user from games', { userId: parsed.userId, error: err });
                    });
                } else if (parsed.event === 'unbanUser') {
                    // Don't block the event handler - unban is async but we don't need to wait
                    removeUserFromKickedSets(parsed.userId).catch(err => {
                        logger.error('Error removing user from kicked sets', { userId: parsed.userId, error: err });
                    });
                } else if (parsed.event === 'banStatusUpdate') {
                    // Notify producers in all broadcasts the user might be in
                    if (parsed.broadcastId) {
                        // Specific broadcast
                        notifyProducerBanUpdate(parsed.broadcastId, parsed.userId).catch(err => {
                            logger.error('Error notifying producers of ban update', { 
                                broadcastId: parsed.broadcastId, 
                                userId: parsed.userId, 
                                error: err 
                            });
                        });
                    } else {
                        // Notify all broadcasts the user is in
                        Object.entries(wsServers).forEach(([broadcastIdStr, serverInfo]) => {
                            if (!serverInfo || !serverInfo.active) {
                                return;
                            }
                            const broadcastId = parseInt(broadcastIdStr, 10);
                            if (!isNaN(broadcastId)) {
                                notifyProducerBanUpdate(broadcastId, parsed.userId).catch(err => {
                                    logger.error('Error notifying producers of ban update', { 
                                        broadcastId, 
                                        userId: parsed.userId, 
                                        error: err 
                                    });
                                });
                            }
                        });
                    }
                }
            } catch (e) {
                logger.error('Error handling user event', { error: e, message: m });
            }
        });
    }).catch(err => {
        logger.error('Failed to initialize user event listener', { error: err });
    });
}


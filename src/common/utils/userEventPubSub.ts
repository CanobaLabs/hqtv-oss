import { gzip } from 'zlib';
import { promisify } from 'util';
import logger from '../logger';
import redis from '../redisClient';
import serverId from '../serverId';

const gzipAsync = promisify(gzip);

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

// Reuse a single Redis connection for publishing to avoid connection overhead
let pubConnection: ReturnType<typeof redis.duplicate> | null = null;

async function getPubConnection() {
    if (!pubConnection) {
        pubConnection = redis.duplicate();
        await pubConnection.connect();
    }
    return pubConnection;
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
 * Publish a user event to all WebSocket servers via Redis pub/sub
 * This is called from the API server when bans are applied
 */
export async function publishUserEvent(event: UserEventType, userId: number, reason?: string, broadcastId?: number) {
    try {
        const pub = await getPubConnection();
        
        const payload: UserEvent = { 
            event, 
            userId, 
            serverId,
            reason,
            broadcastId
        };
        const jsonString = JSON.stringify(payload);
        
        // Compress the message before publishing
        const compressedMessage = await compressMessage(jsonString);
        
        await pub.publish('userEvents', compressedMessage);
        
        logger.info(`Published user event: ${event} for user ${userId}`);
    } catch (e) {
        logger.error('Failed to publish user event:', { error: e, event, userId });
        // Reset connection on error so it can be recreated next time
        pubConnection = null;
    }
}

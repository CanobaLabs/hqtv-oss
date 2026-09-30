import { gzip, gunzip } from 'zlib';
import { promisify } from 'util';
import logger from '../../common/logger';
import redis from '../../common/redisClient';
import serverId from '../../common/serverId';
import gameSubHandlers from '../wsTypes/gameSubHandlersMap';
import CrossServerEvent from '../wsTypes/CrossServerEvent';
import { wsServers } from '../wsServers';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

// Compression threshold: only compress messages larger than this (bytes)
// Small messages don't benefit from compression and add overhead
const COMPRESSION_THRESHOLD = 200;

// String prefix to identify compressed messages (Redis-safe)
const COMPRESSED_PREFIX = 'gz:';

const pub = redis.duplicate();
pub.connect();

/**
 * Compress a JSON string if it's large enough to benefit from compression
 * Returns the compressed data as a base64 string with a prefix, or the original string if too small
 */
async function compressMessage(jsonString: string): Promise<string> {
	// Don't compress small messages - compression overhead isn't worth it
	if (jsonString.length < COMPRESSION_THRESHOLD) {
		return jsonString;
	}

	try {
		const inputBuffer = Buffer.from(jsonString, 'utf8');
		const compressed = await gzipAsync(inputBuffer) as Buffer;
		// Use base64 encoding for Redis compatibility (Redis pub/sub uses strings)
		// Prefix with marker to identify compressed messages
		return COMPRESSED_PREFIX + compressed.toString('base64');
	} catch (error) {
		logger.error({ error }, 'Failed to compress message, sending uncompressed');
		// Fallback to uncompressed if compression fails
		return jsonString;
	}
}

/**
 * Decompress a message if it's compressed, otherwise return as-is
 */
async function decompressMessage(message: string): Promise<string> {
	// Check if message is compressed (starts with compression prefix)
	if (!message.startsWith(COMPRESSED_PREFIX)) {
		// Not compressed, return as-is (backward compatibility)
		return message;
	}

	try {
		// Remove prefix and decode base64
		const base64Data = message.slice(COMPRESSED_PREFIX.length);
		const compressedBuffer = Buffer.from(base64Data, 'base64');
		const decompressed = await gunzipAsync(compressedBuffer) as Buffer;
		return decompressed.toString('utf8');
	} catch (error) {
		logger.error({ error }, 'Failed to decompress message, attempting to parse as JSON');
		// If decompression fails, try parsing as regular JSON (backward compatibility)
		return message;
	}
}

const connectListener = async function(broadcastId: number) {
	// events from all servers (question start, etc.) are received here
	const sub = await redis.duplicate().connect();
	sub.subscribe(`gameEvent-${broadcastId}`, async m => {
		try {
			// Decompress message if needed
			const decompressed = await decompressMessage(m);
			const parsed: CrossServerEvent = JSON.parse(decompressed);
			if (parsed.serverId == serverId) return; // ignore events sent from the current server

			const handler = gameSubHandlers[parsed.event];
			await handler?.(parsed.broadcastId, parsed.metadata)
		} catch (e) {
			logger.error(e);
		}
	});
}

const sendAllServers = async function(event: keyof typeof gameSubHandlers, broadcastId: number, metadata: any = {}) {
	const payload: CrossServerEvent = { event, broadcastId, serverId, metadata };
	const jsonString = JSON.stringify(payload);
	
	// Compress the message before publishing
	const compressedMessage = await compressMessage(jsonString);
	
	await pub.publish(`gameEvent-${broadcastId}`, compressedMessage)
		.catch(e => logger.error('Failed to publish event:', e));
	await gameSubHandlers[event](broadcastId, metadata)
		.catch(e => logger.error('Failed to run event:', e));
}

export default { connectListener, sendAllServers };

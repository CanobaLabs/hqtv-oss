import rateLimit from 'express-rate-limit';
import ms from 'ms';
import RedisStore from 'rate-limit-redis';
import redis from '../../common/redisClient';
import { getClientIp } from '../utils/getClientIp';
import getGeneralConfig from '../utils/getGeneralConfig';

let cachedRateLimiter: ReturnType<typeof rateLimit> | null = null;
let lastConfigFetch = 0;
const CONFIG_CACHE_MS = 60000; // Cache config for 1 minute

async function getRateLimiter() {
	const now = Date.now();
	if (!cachedRateLimiter || (now - lastConfigFetch) > CONFIG_CACHE_MS) {
		const config = await getGeneralConfig();
		cachedRateLimiter = rateLimit({
			windowMs: ms(`${config.apiRateLimitWindowSec} seconds`),
			limit: config.apiRateLimitMaxRequests,
			legacyHeaders: false,
			store: new RedisStore({ sendCommand: (...args: string[]) => redis.sendCommand(args) }), // carry across servers
			keyGenerator: (req) => getClientIp(req) ?? req.ip ?? 'unknown',
			skip: (req) => req.path.startsWith('/ap')
		});
		lastConfigFetch = now;
	}
	return cachedRateLimiter;
}

const rateLimiter = async (req: any, res: any, next: any) => {
	const limiter = await getRateLimiter();
	return limiter(req, res, next);
};

export default rateLimiter;

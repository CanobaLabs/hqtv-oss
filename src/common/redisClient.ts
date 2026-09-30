import { configDotenv } from 'dotenv';
import { createClient } from 'redis';
import logger from './logger';

configDotenv();

const redis = createClient({ url: process.env.REDIS_URL });

redis.on('error', (err) => {
    logger.error({
        context: 'redis error',
        error: err
    });
});

redis.connect();

export default redis;

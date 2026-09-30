import logger from '../../logger';
import redis from '../../redisClient';
import rKey from '../../redisKeys';

const MIGRATION_KEY = rKey.schemaMigrations('set-stream-boot-status-destroyed');
const MIGRATION_RUNNING_VALUE = 'running';
const MIGRATION_DONE_VALUE = 'done';
const MIGRATION_LOCK_TTL_MS = 10 * 60 * 1000; // 10 minutes

export default async function setStreamBootStatusToDestroyed(): Promise<boolean> {
    let lockAcquired = false;
    let completed = false;
    
    try {
        const cachedValue = await redis.get(MIGRATION_KEY);
        if (cachedValue === MIGRATION_DONE_VALUE) {
            return false;
        }
        if (cachedValue === MIGRATION_RUNNING_VALUE) {
            logger.info('setStreamBootStatusToDestroyed: migration already running elsewhere');
            return false;
        }

        const setResult = await redis.set(MIGRATION_KEY, MIGRATION_RUNNING_VALUE, {
            NX: true,
            PX: MIGRATION_LOCK_TTL_MS
        });
        if (!setResult) {
            const latestValue = await redis.get(MIGRATION_KEY);
            if (latestValue === MIGRATION_DONE_VALUE) {
                return false;
            }
            logger.info('setStreamBootStatusToDestroyed: unable to acquire migration lock');
            return false;
        }

        lockAcquired = true;

        await redis.set(rKey.bootStatus('stream'), 'destroyed');
        await redis.set(rKey.bootStatus('hls'), 'destroyed');
        logger.info('setStreamBootStatusToDestroyed: migration completed. Set stream bootStatus to destroyed');

        await redis.set(MIGRATION_KEY, MIGRATION_DONE_VALUE);
        completed = true;
        return true;
    } catch (error) {
        if (lockAcquired) {
            await redis.del(MIGRATION_KEY);
        }
        logger.error({ error }, 'setStreamBootStatusToDestroyed: migration failed');
        throw error;
    } finally {
        if (lockAcquired && !completed) {
            await redis.del(MIGRATION_KEY);
        }
    }
}

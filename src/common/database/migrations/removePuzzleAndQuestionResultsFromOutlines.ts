import logger from '../../logger';
import redis from '../../redisClient';
import rKey from '../../redisKeys';
import { outline } from '../../mongoClient';

const MIGRATION_KEY = rKey.schemaMigrations('remove-puzzle-question-results-outlines');
const MIGRATION_RUNNING_VALUE = 'running';
const MIGRATION_DONE_VALUE = 'done';
const MIGRATION_LOCK_TTL_MS = 10 * 60 * 1000; // 10 minutes

export default async function removePuzzleAndQuestionResultsFromOutlines(): Promise<boolean> {
    let lockAcquired = false;
    let completed = false;
    
    try {
        const cachedValue = await redis.get(MIGRATION_KEY);
        if (cachedValue === MIGRATION_DONE_VALUE) {
            return false;
        }
        if (cachedValue === MIGRATION_RUNNING_VALUE) {
            logger.info('removePuzzleAndQuestionResultsFromOutlines: migration already running elsewhere');
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
            logger.info('removePuzzleAndQuestionResultsFromOutlines: unable to acquire migration lock');
            return false;
        }

        lockAcquired = true;

        // Use MongoDB's $pull operator to remove items with itemType "puzzleResults" or "questionResults"
        const result = await outline.updateMany(
            {},
            {
                $pull: {
                    outline: {
                        $or: [
                            { itemType: 'puzzleResults' },
                            { itemType: 'questionResults' }
                        ]
                    }
                }
            }
        );

        logger.info(
            `removePuzzleAndQuestionResultsFromOutlines: migration completed. Matched ${result.matchedCount} outlines, modified ${result.modifiedCount} outlines`
        );

        await redis.set(MIGRATION_KEY, MIGRATION_DONE_VALUE);
        completed = true;
        return result.modifiedCount > 0;
    } catch (error) {
        if (lockAcquired) {
            await redis.del(MIGRATION_KEY);
        }
        logger.error({ error }, 'removePuzzleAndQuestionResultsFromOutlines: migration failed');
        throw error;
    } finally {
        if (lockAcquired && !completed) {
            await redis.del(MIGRATION_KEY);
        }
    }
}


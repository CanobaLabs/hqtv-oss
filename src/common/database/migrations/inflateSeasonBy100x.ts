import { literal } from 'sequelize';
import SeasonLevel from '../configModels/seasonLevels';
import SeasonPuzzlePoints from '../configModels/seasonPuzzlePoints';
import SeasonQuestionPoints from '../configModels/seasonQuestionPoints';
import ItemHistory from '../userModels/itemHistory';
import logger from '../../logger';
import redis from '../../redisClient';
import rKey from '../../redisKeys';
import { bulkCacheUsers } from '../../utils/userGetters';
import Account from '../userModels/account';

const MIGRATION_KEY = rKey.schemaMigrations('deflate-season-by-10x');
const MIGRATION_RUNNING_VALUE = 'running';
const MIGRATION_DONE_VALUE = 'done';
const MIGRATION_LOCK_TTL_MS = 30 * 60 * 100; // 30 minutes

export default async function inflateSeasonBy10x(): Promise<boolean> {
    let lockAcquired = false;
    let completed = false;
    
    try {
        const cachedValue = await redis.get(MIGRATION_KEY);
        if (cachedValue === MIGRATION_DONE_VALUE) {
            logger.info('inflateSeasonBy10x: migration already completed');
            return false;
        }
        if (cachedValue === MIGRATION_RUNNING_VALUE) {
            logger.info('inflateSeasonBy10x: migration already running elsewhere');
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
            logger.info('inflateSeasonBy10x: unable to acquire migration lock');
            return false;
        }

        lockAcquired = true;
        logger.info('inflateSeasonBy10x: starting migration');

        const levelResult = await SeasonLevel.update(
            {
                minPoints: literal('ROUND(minPoints / 10)'),
                maxPoints: literal('ROUND(maxPoints / 10)')
            },
            { where: {} }
        );
        logger.info({ rowsAffected: levelResult[0] }, 'inflateSeasonBy10x: updated season levels');

        const questionPointsResult = await SeasonQuestionPoints.update(
            {
                points: literal('ROUND(points / 10)')
            },
            { where: {} }
        );
        logger.info({ rowsAffected: questionPointsResult[0] }, 'inflateSeasonBy10x: updated question points');

        const puzzlePointsResult = await SeasonPuzzlePoints.update(
            {
                points: literal('ROUND(points / 10)')
            },
            { where: {} }
        );
        logger.info({ rowsAffected: puzzlePointsResult[0] }, 'inflateSeasonBy10x: updated puzzle points');

        const itemHistoryResult = await ItemHistory.update(
            {
                qty: literal('ROUND(qty / 10)')
            },
            { where: { item: 'seasonXp', seasonId: 'partner2025' } }
        );
        logger.info({ rowsAffected: itemHistoryResult[0] }, 'inflateSeasonBy10x: updated user seasonXp in itemHistory');

        await redis.del(rKey.seasonConfig);
        await redis.del(rKey.seasonLevels);
        await redis.del(rKey.questionPoints);
        await redis.del(rKey.puzzlePoints);
        logger.info('inflateSeasonBy10x: cleared season Redis cache');

        const userIds = (await Account.findAll({ attributes: ['id'] })).map(a => a.id);
        logger.info({ userCount: userIds.length }, 'inflateSeasonBy10x: refreshing user caches');
        await bulkCacheUsers(userIds);
        logger.info('inflateSeasonBy10x: refreshed all user caches');

        await redis.set(MIGRATION_KEY, MIGRATION_DONE_VALUE);
        completed = true;
        logger.info('inflateSeasonBy10x: migration completed successfully');
        return true;
    } catch (error) {
        if (lockAcquired) {
            await redis.del(MIGRATION_KEY);
        }
        logger.error({ error }, 'inflateSeasonBy10x: migration failed');
        throw error;
    } finally {
        if (lockAcquired && !completed) {
            await redis.del(MIGRATION_KEY);
        }
    }
}


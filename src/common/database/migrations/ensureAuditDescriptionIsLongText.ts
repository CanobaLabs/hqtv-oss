import logger from '../../logger';
import redis from '../../redisClient';
import rKey from '../../redisKeys';
import { adminDb } from '../connections';

const MIGRATION_KEY = rKey.schemaMigrations('audit-description-longtext');
const MIGRATION_RUNNING_VALUE = 'running';
const MIGRATION_DONE_VALUE = 'done';
const MIGRATION_LOCK_TTL_MS = 5 * 60 * 1000;

type ShowColumnRow = {
	Field: string;
	Type: string;
	Null: 'YES' | 'NO';
	Key: string;
	Default: string | null;
	Extra: string;
	Collation?: string;
};

export default async function ensureAuditDescriptionIsLongText(): Promise<boolean> {
	let lockAcquired = false;
	let completed = false;
	try {
		const cachedValue = await redis.get(MIGRATION_KEY);
		if (cachedValue === MIGRATION_DONE_VALUE) {
			return false;
		}
		if (cachedValue === MIGRATION_RUNNING_VALUE) {
			logger.info('ensureAuditDescriptionIsLongText: migration already running elsewhere');
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
			logger.info('ensureAuditDescriptionIsLongText: unable to acquire migration lock');
			return false;
		}

		lockAcquired = true;

		const [rows] = await adminDb.query('SHOW COLUMNS FROM audit LIKE :columnName', {
			replacements: { columnName: 'description' }
		});

		const columnInfo = Array.isArray(rows) && rows.length > 0 ? (rows[0] as ShowColumnRow) : null;
		if (!columnInfo) {
			logger.warn('ensureAuditDescriptionIsLongText: description column missing from audit table');
			await redis.set(MIGRATION_KEY, MIGRATION_DONE_VALUE);
			completed = true;
			return false;
		}

		const columnType = columnInfo.Type.toLowerCase();
		const isAlreadyText =
			columnType.includes('text') && !columnType.startsWith('tinytext');
		if (isAlreadyText) {
			await redis.set(MIGRATION_KEY, MIGRATION_DONE_VALUE);
			completed = true;
			return false;
		}

		await adminDb.query('ALTER TABLE audit MODIFY COLUMN description LONGTEXT NOT NULL');
		logger.info('ensureAuditDescriptionIsLongText: converted description column to LONGTEXT');

		await redis.set(MIGRATION_KEY, MIGRATION_DONE_VALUE);
		completed = true;
		return true;
	} catch (error) {
		if (lockAcquired) {
			await redis.del(MIGRATION_KEY);
		}
		logger.error({ error }, 'ensureAuditDescriptionIsLongText: migration failed');
		throw error;
	} finally {
		if (lockAcquired && !completed) {
			await redis.del(MIGRATION_KEY);
		}
	}
}



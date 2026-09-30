import logger from '../../logger';
import redis from '../../redisClient';
import rKey from '../../redisKeys';
import { adminDb } from '../connections';

const MIGRATION_KEY = rKey.schemaMigrations('audit-type-columns-varchar');

type ShowColumnRow = {
	Field: string;
	Type: string;
	Null: 'YES' | 'NO';
	Key: string;
	Default: string | null;
	Extra: string;
};

type ColumnConfig = {
	name: string;
	length: number;
	allowNull: boolean;
};

const COLUMNS: ColumnConfig[] = [
	{ name: 'toType', length: 255, allowNull: false },
	{ name: 'fromType', length: 255, allowNull: false },
	{ name: 'subToType', length: 255, allowNull: true },
	{ name: 'action', length: 255, allowNull: false },
];

export default async function ensureAuditTypeColumnsAreVarChar(): Promise<boolean> {
	try {
		const cachedValue = await redis.get(MIGRATION_KEY);
		if (cachedValue === 'done') {
			return false;
		}

		let alteredAny = false;
		for (const column of COLUMNS) {
			const [rows] = await adminDb.query('SHOW COLUMNS FROM audit LIKE :columnName', {
				replacements: { columnName: column.name }
			});

			const columnInfo = Array.isArray(rows) && rows.length > 0 ? (rows[0] as ShowColumnRow) : null;
			if (!columnInfo) {
				logger.warn({ column: column.name }, 'ensureAuditTypeColumnsAreVarChar: column missing from audit table');
				continue;
			}

			const columnType = columnInfo.Type.toLowerCase();
			if (!columnType.startsWith('enum')) {
				continue;
			}

			const nullSql = column.allowNull ? 'NULL' : 'NOT NULL';
			const defaultClause = columnInfo.Default !== null ? `DEFAULT ${adminDb.escape(columnInfo.Default)}` : column.allowNull ? 'DEFAULT NULL' : '';

			await adminDb.query(
				`ALTER TABLE audit MODIFY COLUMN ${column.name} VARCHAR(${column.length}) ${nullSql} ${defaultClause}`.trim()
			);
			logger.info({ column: column.name }, 'ensureAuditTypeColumnsAreVarChar: converted enum to VARCHAR');
			alteredAny = true;
		}

		if (alteredAny) {
			logger.info('ensureAuditTypeColumnsAreVarChar: migration completed');
		}

		await redis.set(MIGRATION_KEY, 'done');
		return alteredAny;
	} catch (error) {
		logger.error({ error }, 'ensureAuditTypeColumnsAreVarChar: migration failed');
		throw error;
	}
}


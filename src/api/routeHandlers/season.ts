import Audit from '../../common/database/adminModels/audit';
import SeasonConfig from '../../common/database/configModels/seasonConfig';
import SeasonLevel from '../../common/database/configModels/seasonLevels';
import Account from '../../common/database/userModels/account';
import ItemHistory from '../../common/database/userModels/itemHistory';
import HqError from '../../common/hqError';
import ParsedSeasonConfig from '../../common/types/parsedSeasonConfig';
import levelFromPoints from '../../common/utils/levelFromPoints';
import adjustItemBalance from '../../common/utils/adjustItemBalance';
import { getUser } from '../../common/utils/userGetters';
import getSeason from '../utils/getSeason';
import * as seasonXp from './seasonXp';
import { Op, fn, col } from 'sequelize';

const AUDIT_DESCRIPTION_MAX_LENGTH = 1000;

type SerializableRecord = Record<string, unknown>;

function ensureBodyObject(body: unknown): Record<string, unknown> {
	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		throw new HqError('Request body must be an object', 0, 400);
	}
	return body as Record<string, unknown>;
}

function coerceNumber(value: unknown, field: string): number {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (trimmed.length > 0) {
			const parsed = Number(trimmed);
			if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
				return parsed;
			}
		}
	}
	throw new HqError(`${field} must be a finite number`, 0, 400);
}

function coerceTinyInt(value: unknown, field: string): number {
	if (typeof value === 'boolean') {
		return value ? 1 : 0;
	}
	if (typeof value === 'string') {
		const trimmed = value.trim().toLowerCase();
		if (trimmed === 'true') return 1;
		if (trimmed === 'false') return 0;
	}
	const asNumber = coerceNumber(value, field);
	if (asNumber !== 0 && asNumber !== 1) {
		throw new HqError(`${field} must be either 0 or 1`, 0, 400);
	}
	return asNumber;
}

function coerceString(value: unknown, field: string): string {
	if (typeof value === 'string') {
		return value;
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	throw new HqError(`${field} must be a string`, 0, 400);
}

function coerceOptionalString(value: unknown, field: string): string | null {
	if (value === null || value === undefined || value === '') {
		return null;
	}
	return coerceString(value, field);
}

function coerceDate(value: unknown, field: string): Date {
	if (value instanceof Date) {
		return value;
	}
	if (typeof value === 'string') {
		const parsed = new Date(value);
		if (!Number.isNaN(parsed.getTime())) {
			return parsed;
		}
	}
	throw new HqError(`${field} must be a valid date`, 0, 400);
}

function formatAuditDescription(label: string, payload: SerializableRecord): string {
	const base = `${label}: ${JSON.stringify(payload)}`;
	if (base.length <= AUDIT_DESCRIPTION_MAX_LENGTH) {
		return base;
	}
	return `${base.slice(0, AUDIT_DESCRIPTION_MAX_LENGTH - 3)}...`;
}

async function logConfigChange(options: {
	subTo: string;
	action: string;
	employeeId: string | number;
	details: SerializableRecord;
}) {
	await Audit.create({
		to: 'config',
		toType: 'config',
		subTo: options.subTo,
		subToType: 'season',
		from: String(options.employeeId),
		fromType: 'employee',
		action: options.action,
		description: formatAuditDescription(options.action, options.details)
	});
}

export async function getSeasonConfig(): Promise<ParsedSeasonConfig | null> {
	return await getSeason();
}

export async function updateSeasonConfig(employeeId: string | number, body: unknown) {
	const input = ensureBodyObject(body);
	
	// Get the current enabled season config, or create a new one
	let seasonConfig = await SeasonConfig.findOne({ where: { enabled: 1 } });
	const wasNewRecord = !seasonConfig;
	
	// If updating an existing season, we need seasonId
	const seasonId = input.seasonId ? coerceString(input.seasonId, 'seasonId') : undefined;
	
	// If seasonId is provided, try to find that specific season
	if (seasonId) {
		const foundConfig = await SeasonConfig.findByPk(seasonId);
		if (foundConfig) {
			seasonConfig = foundConfig;
		}
	}
	
	// Prepare update payload - all fields are optional for partial updates
	const updatePayload: Partial<{
		seasonAttributeId: string;
		seasonName: string;
		enabled: number;
		startDate: Date;
		endDate: Date;
		tentpoleEnabled: number;
		tentpoleEnabled_android: string | null;
		finalePrizeCents: number;
		howItWorks: string;
		disclaimer: string;
	}> = {};
	
	// seasonAttributeId is automatically set to match seasonId (for linking related tables)
	if (seasonId && !seasonConfig) {
		// When creating new, set seasonAttributeId = seasonId
		updatePayload.seasonAttributeId = seasonId;
	} else if (seasonId && seasonConfig && seasonConfig.seasonId !== seasonId) {
		// If updating seasonId, also update seasonAttributeId to match
		updatePayload.seasonAttributeId = seasonId;
	}
	if (input.seasonName !== undefined) {
		updatePayload.seasonName = coerceString(input.seasonName, 'seasonName');
	}
	if (input.enabled !== undefined) {
		updatePayload.enabled = coerceTinyInt(input.enabled, 'enabled');
	}
	if (input.startDate !== undefined) {
		updatePayload.startDate = coerceDate(input.startDate, 'startDate');
	}
	if (input.endDate !== undefined) {
		updatePayload.endDate = coerceDate(input.endDate, 'endDate');
	}
	if (input.tentpoleEnabled !== undefined) {
		updatePayload.tentpoleEnabled = coerceTinyInt(input.tentpoleEnabled, 'tentpoleEnabled');
	}
	if (input.tentpoleEnabled_android !== undefined) {
		updatePayload.tentpoleEnabled_android = coerceOptionalString(input.tentpoleEnabled_android, 'tentpoleEnabled_android');
	}
	if (input.finalePrizeCents !== undefined) {
		updatePayload.finalePrizeCents = coerceNumber(input.finalePrizeCents, 'finalePrizeCents');
	}
	if (input.howItWorks !== undefined) {
		updatePayload.howItWorks = coerceString(input.howItWorks, 'howItWorks');
	}
	if (input.disclaimer !== undefined) {
		updatePayload.disclaimer = coerceString(input.disclaimer, 'disclaimer');
	}
	
	// If no season config exists and we're trying to create one, we need required fields
	if (!seasonConfig) {
		if (!seasonId) {
			throw new HqError('seasonId is required when creating a new season config', 0, 400);
		}
		// seasonAttributeId is automatically set to match seasonId
		if (!updatePayload.seasonAttributeId) {
			updatePayload.seasonAttributeId = seasonId;
		}
		if (!updatePayload.seasonName) {
			throw new HqError('seasonName is required when creating a new season config', 0, 400);
		}
		if (updatePayload.enabled === undefined) {
			throw new HqError('enabled is required when creating a new season config', 0, 400);
		}
		if (!updatePayload.startDate) {
			throw new HqError('startDate is required when creating a new season config', 0, 400);
		}
		if (!updatePayload.endDate) {
			throw new HqError('endDate is required when creating a new season config', 0, 400);
		}
		if (updatePayload.tentpoleEnabled === undefined) {
			throw new HqError('tentpoleEnabled is required when creating a new season config', 0, 400);
		}
		if (updatePayload.finalePrizeCents === undefined) {
			throw new HqError('finalePrizeCents is required when creating a new season config', 0, 400);
		}
		if (!updatePayload.howItWorks) {
			throw new HqError('howItWorks is required when creating a new season config', 0, 400);
		}
		if (!updatePayload.disclaimer) {
			throw new HqError('disclaimer is required when creating a new season config', 0, 400);
		}
		
		// Create new season config
		seasonConfig = await SeasonConfig.create({
			seasonId: seasonId,
			seasonAttributeId: updatePayload.seasonAttributeId || seasonId,
			seasonName: updatePayload.seasonName,
			enabled: updatePayload.enabled,
			startDate: updatePayload.startDate,
			endDate: updatePayload.endDate,
			tentpoleEnabled: updatePayload.tentpoleEnabled,
			tentpoleEnabled_android: updatePayload.tentpoleEnabled_android ?? null,
			finalePrizeCents: updatePayload.finalePrizeCents,
			howItWorks: updatePayload.howItWorks,
			disclaimer: updatePayload.disclaimer
		});
	} else {
		// Update existing season config
		if (Object.keys(updatePayload).length === 0) {
			throw new HqError('No fields provided to update', 0, 400);
		}
		
		// If enabling a season, disable all others first
		if (updatePayload.enabled === 1) {
			await SeasonConfig.update({ enabled: 0 }, { where: { enabled: 1 } });
		}
		
		await SeasonConfig.update(updatePayload, { where: { seasonId: seasonConfig.seasonId } });
		// Refetch the updated config to ensure we have the latest data
		const updatedConfig = await SeasonConfig.findByPk(seasonConfig.seasonId);
		if (updatedConfig) {
			seasonConfig = updatedConfig;
		} else {
			// If we can't find the updated config, something went wrong
			throw new HqError('Failed to retrieve updated season config', 0, 500);
		}
	}
	
	// Invalidate cache and refresh
	// Note: We don't check if enabled here because refreshSeason will handle it
	// If the season isn't enabled, refreshSeason will clear the cache (which is correct)
	await seasonXp.refreshSeason();
	
	const result = await getSeason();
	
	await logConfigChange({
		subTo: 'season',
		action: wasNewRecord ? 'create_season_config' : 'update_season_config',
		employeeId,
		details: {
			seasonId: seasonConfig.seasonId,
			...updatePayload
		}
	});
	
	return result;
}

export async function updateUserSeasonPoints(employeeId: string | number, userId: number, body: unknown) {
	const input = ensureBodyObject(body);
	const points = input.points !== undefined ? coerceNumber(input.points, 'points') : undefined;
	const adjustment = input.adjustment !== undefined ? coerceNumber(input.adjustment, 'adjustment') : undefined;
	
	if (points === undefined && adjustment === undefined) {
		throw new HqError('Either points (absolute value) or adjustment (relative change) must be provided', 0, 400);
	}
	
	if (points !== undefined && adjustment !== undefined) {
		throw new HqError('Cannot provide both points and adjustment. Use one or the other.', 0, 400);
	}
	
	// Get current user to check their existing points
	const user = await getUser(userId);
	const currentPoints = user.seasonXp;
	
	let newPoints: number;
	let adjustmentQty: number;
	
	if (points !== undefined) {
		// Set absolute value
		newPoints = points;
		adjustmentQty = points - currentPoints;
	} else {
		// Adjust relative value
		adjustmentQty = adjustment!;
		newPoints = currentPoints + adjustmentQty;
	}
	
	// Ensure points don't go negative
	if (newPoints < 0) {
		throw new HqError('Points cannot be negative', 0, 400);
	}
	
	// Only create ItemHistory entry if there's an actual change
	if (adjustmentQty !== 0) {
		const season = await getSeason();
		await ItemHistory.create({
			userId: userId,
			item: 'seasonXp',
			qty: adjustmentQty,
			reason: `Admin adjustment by employee ${employeeId}`,
			broadcastId: null,
			seasonId: season?.seasonId ?? null
		});
		
		// Refresh user cache
		await getUser(userId, true);
		
		await Audit.create({
			to: userId,
			toType: 'user',
			subTo: 'seasonXp',
			subToType: 'points',
			from: String(employeeId),
			fromType: 'employee',
			action: 'update_user_season_points',
			description: `Updated season points: ${currentPoints} → ${newPoints} (${adjustmentQty > 0 ? '+' : ''}${adjustmentQty})`
		});
	}
	
	// Get updated user
	const updatedUser = await getUser(userId, true);
	const season = await getSeason();
	
	let levelInfo = null;
	if (season) {
		const levelData = levelFromPoints(updatedUser.seasonXp, season.levels);
		levelInfo = {
			level: levelData.level,
			minPoints: levelData.minPoints,
			maxPoints: levelData.maxPoints
		};
	}
	
	return {
		userId: userId,
		previousPoints: currentPoints,
		currentPoints: updatedUser.seasonXp,
		adjustment: adjustmentQty,
		level: levelInfo
	};
}

export async function getSeasonMetrics() {
	const season = await getSeason();
	if (!season) {
		return {
			season: null,
			message: 'No active season'
		};
	}
	
	// Get all users with season XP
	const itemHistories = await ItemHistory.findAll({
		where: {
			item: 'seasonXp',
			counted: true
		},
		attributes: ['userId', [fn('SUM', col('qty')), 'totalPoints']],
		group: ['userId'],
		raw: true
	}) as unknown as Array<{ userId: number; totalPoints: string }>;
	
	// Get user accounts for names and avatars
	const userIds = itemHistories.map(h => h.userId);
	const accounts = await Account.findAll({
		where: { id: { [Op.in]: userIds } },
		attributes: ['id', 'name', 'avatarUrl']
	});
	const accountMap = new Map(accounts.map(acc => [acc.id, acc]));
	
	// Calculate metrics
	const userPoints = itemHistories.map(h => {
		const account = accountMap.get(h.userId);
		return {
			userId: h.userId,
			points: parseInt(h.totalPoints, 10) || 0,
			name: account?.name ?? 'Unknown',
			avatarUrl: account?.avatarUrl ?? null
		};
	});
	
	const totalUsers = userPoints.length;
	const totalPoints = userPoints.reduce((sum, u) => sum + u.points, 0);
	const averagePoints = totalUsers > 0 ? totalPoints / totalUsers : 0;
	
	// Calculate levels for each user
	const levelCounts: { [level: number]: number } = {};
	let totalLevels = 0;
	
	userPoints.forEach(user => {
		const levelData = levelFromPoints(user.points, season.levels);
		const level = levelData.level;
		levelCounts[level] = (levelCounts[level] || 0) + 1;
		totalLevels += level;
	});
	
	const averageLevel = totalUsers > 0 ? totalLevels / totalUsers : 0;
	
	// Build level distribution
	const levelDistribution = season.levels.map(levelInfo => {
		const count = levelCounts[levelInfo.level] || 0;
		const percentage = totalUsers > 0 ? (count / totalUsers) * 100 : 0;
		return {
			level: levelInfo.level,
			minPoints: levelInfo.minPoints,
			maxPoints: levelInfo.maxPoints,
			userCount: count,
			percentage: Math.round(percentage * 100) / 100
		};
	});
	
	// Get top players
	const topPlayers = userPoints
		.sort((a, b) => b.points - a.points)
		.slice(0, 10)
		.map((user, index) => {
			const levelData = levelFromPoints(user.points, season.levels);
			return {
				rank: index + 1,
				userId: user.userId,
				name: user.name,
				avatarUrl: user.avatarUrl,
				points: user.points,
				level: levelData.level
			};
		});
	
	return {
		season: {
			seasonId: season.seasonId,
			seasonName: season.seasonName
		},
		summary: {
			totalUsers: totalUsers,
			totalPoints: totalPoints,
			averagePoints: Math.round(averagePoints * 100) / 100,
			averageLevel: Math.round(averageLevel * 100) / 100
		},
		levelDistribution: levelDistribution,
		topPlayers: topPlayers
	};
}

export async function getSeasonLevels() {
	const season = await getSeason();
	if (!season) {
		return {
			season: null,
			levels: [],
			message: 'No active season'
		};
	}
	
	// Get the actual season config from database to access seasonAttributeId
	const seasonConfig = await SeasonConfig.findOne({ where: { enabled: 1 } });
	if (!seasonConfig) {
		return {
			season: {
				seasonId: season.seasonId,
				seasonName: season.seasonName
			},
			levels: [],
			message: 'Season config not found in database'
		};
	}
	
	const levels = await SeasonLevel.findAll({
		where: { seasonAttributeId: seasonConfig.seasonAttributeId },
		order: [['levelNumber', 'ASC']]
	});
	
	return {
		season: {
			seasonId: season.seasonId,
			seasonName: season.seasonName
		},
		levels: levels.map(level => ({
			itemId: level.itemId,
			levelNumber: level.levelNumber,
			minPoints: level.minPoints,
			maxPoints: level.maxPoints,
			description: level.description,
			textColor: level.textColor,
			accentColor: level.accentColor,
			textAccentColor: level.textAccentColor,
			cardBgImage: level.cardBgImage,
			bgColor: level.bgColor,
			bgImage: level.bgImage
		}))
	};
}

export async function createSeasonLevel(employeeId: string | number, body: unknown) {
	const input = ensureBodyObject(body);
	const season = await getSeason();
	if (!season) {
		throw new HqError('No active season. Please create a season first.', 0, 400);
	}
	
	// Get the actual season config from database to access seasonAttributeId
	const seasonConfig = await SeasonConfig.findOne({ where: { enabled: 1 } });
	if (!seasonConfig) {
		throw new HqError('Season config not found in database', 0, 400);
	}
	
	const levelNumber = coerceNumber(input.levelNumber, 'levelNumber');
	const minPoints = coerceNumber(input.minPoints, 'minPoints');
	const maxPoints = coerceNumber(input.maxPoints, 'maxPoints');
	const description = coerceString(input.description, 'description');
	const textColor = coerceString(input.textColor, 'textColor');
	const accentColor = coerceString(input.accentColor, 'accentColor');
	const textAccentColor = coerceString(input.textAccentColor, 'textAccentColor');
	const cardBgImage = coerceString(input.cardBgImage, 'cardBgImage');
	const bgColor = coerceString(input.bgColor, 'bgColor');
	const bgImage = coerceString(input.bgImage, 'bgImage');
	
	// Validate points
	if (minPoints < 0) {
		throw new HqError('minPoints cannot be negative', 0, 400);
	}
	if (maxPoints < minPoints) {
		throw new HqError('maxPoints must be greater than or equal to minPoints', 0, 400);
	}
	if (levelNumber < 0) {
		throw new HqError('levelNumber must be at least 0', 0, 400);
	}
	
	// Check if level number already exists
	const existingLevel = await SeasonLevel.findOne({
		where: {
			seasonAttributeId: seasonConfig.seasonAttributeId,
			levelNumber: levelNumber
		}
	});
	if (existingLevel) {
		throw new HqError(`Level ${levelNumber} already exists for this season`, 0, 400);
	}
	
	const level = await SeasonLevel.create({
		seasonAttributeId: seasonConfig.seasonAttributeId,
		levelNumber: levelNumber,
		minPoints: minPoints,
		maxPoints: maxPoints,
		description: description,
		textColor: textColor,
		accentColor: accentColor,
		textAccentColor: textAccentColor,
		cardBgImage: cardBgImage,
		bgColor: bgColor,
		bgImage: bgImage
	});
	
	// Refresh season cache
	await seasonXp.refreshSeason();
	
	await logConfigChange({
		subTo: 'seasonLevel',
		action: 'create_season_level',
		employeeId,
		details: {
			itemId: level.itemId,
			levelNumber: level.levelNumber,
			minPoints: level.minPoints,
			maxPoints: level.maxPoints
		}
	});
	
	return {
		itemId: level.itemId,
		levelNumber: level.levelNumber,
		minPoints: level.minPoints,
		maxPoints: level.maxPoints,
		description: level.description,
		textColor: level.textColor,
		accentColor: level.accentColor,
		textAccentColor: level.textAccentColor,
		cardBgImage: level.cardBgImage,
		bgColor: level.bgColor,
		bgImage: level.bgImage
	};
}

export async function updateSeasonLevel(employeeId: string | number, itemId: number, body: unknown) {
	const input = ensureBodyObject(body);
	const season = await getSeason();
	if (!season) {
		throw new HqError('No active season', 0, 400);
	}
	
	// Get the actual season config from database to access seasonAttributeId
	const seasonConfig = await SeasonConfig.findOne({ where: { enabled: 1 } });
	if (!seasonConfig) {
		throw new HqError('Season config not found in database', 0, 400);
	}
	
	const level = await SeasonLevel.findByPk(itemId);
	if (!level) {
		throw new HqError('Level not found', 0, 404);
	}
	
	// Verify level belongs to current season
	if (level.seasonAttributeId !== seasonConfig.seasonAttributeId) {
		throw new HqError('Level does not belong to the active season', 0, 400);
	}
	
	const updatePayload: Partial<{
		levelNumber: number;
		minPoints: number;
		maxPoints: number;
		description: string;
		textColor: string;
		accentColor: string;
		textAccentColor: string;
		cardBgImage: string;
		bgColor: string;
		bgImage: string;
	}> = {};
	
	if (input.levelNumber !== undefined) {
		const levelNumber = coerceNumber(input.levelNumber, 'levelNumber');
		if (levelNumber < 0) {
			throw new HqError('levelNumber must be at least 0', 0, 400);
		}
		// Check if new level number conflicts with existing level
		if (levelNumber !== level.levelNumber) {
			const existingLevel = await SeasonLevel.findOne({
				where: {
					seasonAttributeId: seasonConfig.seasonAttributeId,
					levelNumber: levelNumber
				}
			});
			if (existingLevel) {
				throw new HqError(`Level ${levelNumber} already exists for this season`, 0, 400);
			}
		}
		updatePayload.levelNumber = levelNumber;
	}
	if (input.minPoints !== undefined) {
		const minPoints = coerceNumber(input.minPoints, 'minPoints');
		if (minPoints < 0) {
			throw new HqError('minPoints cannot be negative', 0, 400);
		}
		updatePayload.minPoints = minPoints;
	}
	if (input.maxPoints !== undefined) {
		const maxPoints = coerceNumber(input.maxPoints, 'maxPoints');
		updatePayload.maxPoints = maxPoints;
	}
	if (input.description !== undefined) {
		updatePayload.description = coerceString(input.description, 'description');
	}
	if (input.textColor !== undefined) {
		updatePayload.textColor = coerceString(input.textColor, 'textColor');
	}
	if (input.accentColor !== undefined) {
		updatePayload.accentColor = coerceString(input.accentColor, 'accentColor');
	}
	if (input.textAccentColor !== undefined) {
		updatePayload.textAccentColor = coerceString(input.textAccentColor, 'textAccentColor');
	}
	if (input.cardBgImage !== undefined) {
		updatePayload.cardBgImage = coerceString(input.cardBgImage, 'cardBgImage');
	}
	if (input.bgColor !== undefined) {
		updatePayload.bgColor = coerceString(input.bgColor, 'bgColor');
	}
	if (input.bgImage !== undefined) {
		updatePayload.bgImage = coerceString(input.bgImage, 'bgImage');
	}
	
	// Validate min/max points relationship
	const finalMinPoints = updatePayload.minPoints ?? level.minPoints;
	const finalMaxPoints = updatePayload.maxPoints ?? level.maxPoints;
	if (finalMaxPoints < finalMinPoints) {
		throw new HqError('maxPoints must be greater than or equal to minPoints', 0, 400);
	}
	
	if (Object.keys(updatePayload).length === 0) {
		throw new HqError('No fields provided to update', 0, 400);
	}
	
	await SeasonLevel.update(updatePayload, { where: { itemId: itemId } });
	
	// Refetch the updated level to ensure we have the latest data
	const updatedLevel = await SeasonLevel.findByPk(itemId);
	if (!updatedLevel) {
		throw new HqError('Failed to retrieve updated level', 0, 500);
	}
	
	// Refresh season cache
	await seasonXp.refreshSeason();
	
	await logConfigChange({
		subTo: 'seasonLevel',
		action: 'update_season_level',
		employeeId,
		details: {
			itemId: updatedLevel.itemId,
			levelNumber: updatedLevel.levelNumber,
			...updatePayload
		}
	});
	
	return {
		itemId: updatedLevel.itemId,
		levelNumber: updatedLevel.levelNumber,
		minPoints: updatedLevel.minPoints,
		maxPoints: updatedLevel.maxPoints,
		description: updatedLevel.description,
		textColor: updatedLevel.textColor,
		accentColor: updatedLevel.accentColor,
		textAccentColor: updatedLevel.textAccentColor,
		cardBgImage: updatedLevel.cardBgImage,
		bgColor: updatedLevel.bgColor,
		bgImage: updatedLevel.bgImage
	};
}

export async function deleteSeasonLevel(employeeId: string | number, itemId: number) {
	const season = await getSeason();
	if (!season) {
		throw new HqError('No active season', 0, 400);
	}
	
	// Get the actual season config from database to access seasonAttributeId
	const seasonConfig = await SeasonConfig.findOne({ where: { enabled: 1 } });
	if (!seasonConfig) {
		throw new HqError('Season config not found in database', 0, 400);
	}
	
	const level = await SeasonLevel.findByPk(itemId);
	if (!level) {
		throw new HqError('Level not found', 0, 404);
	}
	
	// Verify level belongs to current season
	if (level.seasonAttributeId !== seasonConfig.seasonAttributeId) {
		throw new HqError('Level does not belong to the active season', 0, 400);
	}
	
	const levelInfo = {
		itemId: level.itemId,
		levelNumber: level.levelNumber,
		minPoints: level.minPoints,
		maxPoints: level.maxPoints
	};
	
	await SeasonLevel.destroy({ where: { itemId: itemId } });
	
	// Refresh season cache
	await seasonXp.refreshSeason();
	
	await logConfigChange({
		subTo: 'seasonLevel',
		action: 'delete_season_level',
		employeeId,
		details: levelInfo
	});
	
	return { success: true, deletedLevel: levelInfo };
}

export async function replaceSeasonLevels(employeeId: string | number, body: unknown) {
	const input = ensureBodyObject(body);
	const season = await getSeason();
	if (!season) {
		throw new HqError('No active season. Please create a season first.', 0, 400);
	}
	
	// Get the actual season config from database to access seasonAttributeId
	const seasonConfig = await SeasonConfig.findOne({ where: { enabled: 1 } });
	if (!seasonConfig) {
		throw new HqError('Season config not found in database', 0, 400);
	}
	
	if (!Array.isArray(input.levels)) {
		throw new HqError('levels must be an array', 0, 400);
	}
	
	const levels = input.levels as unknown[];
	if (levels.length === 0) {
		throw new HqError('At least one level is required', 0, 400);
	}
	
	// Validate and prepare levels
	const validatedLevels = levels.map((levelInput, index) => {
		const level = ensureBodyObject(levelInput);
		const levelNumber = coerceNumber(level.levelNumber, `levels[${index}].levelNumber`);
		const minPoints = coerceNumber(level.minPoints, `levels[${index}].minPoints`);
		const maxPoints = coerceNumber(level.maxPoints, `levels[${index}].maxPoints`);
		
		if (minPoints < 0) {
			throw new HqError(`levels[${index}].minPoints cannot be negative`, 0, 400);
		}
		if (maxPoints < minPoints) {
			throw new HqError(`levels[${index}].maxPoints must be greater than or equal to minPoints`, 0, 400);
		}
		if (levelNumber < 0) {
			throw new HqError(`levels[${index}].levelNumber must be at least 0`, 0, 400);
		}
		
		return {
			seasonAttributeId: seasonConfig.seasonAttributeId,
			levelNumber: levelNumber,
			minPoints: minPoints,
			maxPoints: maxPoints,
			description: coerceString(level.description, `levels[${index}].description`),
			textColor: coerceString(level.textColor, `levels[${index}].textColor`),
			accentColor: coerceString(level.accentColor, `levels[${index}].accentColor`),
			textAccentColor: coerceString(level.textAccentColor, `levels[${index}].textAccentColor`),
			cardBgImage: coerceString(level.cardBgImage, `levels[${index}].cardBgImage`),
			bgColor: coerceString(level.bgColor, `levels[${index}].bgColor`),
			bgImage: coerceString(level.bgImage, `levels[${index}].bgImage`)
		};
	});
	
	// Check for duplicate level numbers
	const levelNumbers = validatedLevels.map(l => l.levelNumber);
	const duplicates = levelNumbers.filter((num, index) => levelNumbers.indexOf(num) !== index);
	if (duplicates.length > 0) {
		throw new HqError(`Duplicate level numbers found: ${duplicates.join(', ')}`, 0, 400);
	}
	
	// Delete all existing levels for this season
	await SeasonLevel.destroy({ where: { seasonAttributeId: seasonConfig.seasonAttributeId } });
	
	// Create new levels
	const createdLevels = await SeasonLevel.bulkCreate(validatedLevels);
	
	// Refresh season cache
	await seasonXp.refreshSeason();
	
	await logConfigChange({
		subTo: 'seasonLevels',
		action: 'replace_season_levels',
		employeeId,
		details: {
			count: createdLevels.length,
			levelNumbers: createdLevels.map(l => l.levelNumber)
		}
	});
	
	return {
		success: true,
		levels: createdLevels.map(level => ({
			itemId: level.itemId,
			levelNumber: level.levelNumber,
			minPoints: level.minPoints,
			maxPoints: level.maxPoints,
			description: level.description,
			textColor: level.textColor,
			accentColor: level.accentColor,
			textAccentColor: level.textAccentColor,
			cardBgImage: level.cardBgImage,
			bgColor: level.bgColor,
			bgImage: level.bgImage
		}))
	};
}

export async function reorderSeasonLevels(employeeId: string | number, body: unknown) {
	const input = ensureBodyObject(body);
	const season = await getSeason();
	if (!season) {
		throw new HqError('No active season', 0, 400);
	}
	
	// Get the actual season config from database to access seasonAttributeId
	const seasonConfig = await SeasonConfig.findOne({ where: { enabled: 1 } });
	if (!seasonConfig) {
		throw new HqError('Season config not found in database', 0, 400);
	}
	
	if (!Array.isArray(input.order)) {
		throw new HqError('order must be an array of itemIds', 0, 400);
	}
	
	const order = input.order as unknown[];
	if (order.length === 0) {
		throw new HqError('order array cannot be empty', 0, 400);
	}
	
	// Get all levels for this season
	const allLevels = await SeasonLevel.findAll({
		where: { seasonAttributeId: seasonConfig.seasonAttributeId }
	});
	
	if (allLevels.length === 0) {
		throw new HqError('No levels found for this season', 0, 400);
	}
	
	// Validate that all itemIds in order exist and belong to this season
	const levelMap = new Map(allLevels.map(l => [l.itemId, l]));
	const orderedItemIds = order.map(id => {
		const itemId = typeof id === 'number' ? id : coerceNumber(id, 'order itemId');
		if (!levelMap.has(itemId)) {
			throw new HqError(`Level with itemId ${itemId} not found`, 0, 400);
		}
		return itemId;
	});
	
	// Check that all levels are included in the order
	if (orderedItemIds.length !== allLevels.length) {
		const missingItemIds = allLevels
			.filter(l => !orderedItemIds.includes(l.itemId))
			.map(l => l.itemId);
		throw new HqError(`Missing levels in order array: ${missingItemIds.join(', ')}`, 0, 400);
	}
	
	// Check for duplicates
	const uniqueItemIds = new Set(orderedItemIds);
	if (uniqueItemIds.size !== orderedItemIds.length) {
		throw new HqError('Duplicate itemIds found in order array', 0, 400);
	}
	
	// Update level numbers based on the new order
	// The first item in the array gets levelNumber 0, second gets 1, etc.
	const updatePromises = orderedItemIds.map((itemId, index) => {
		const newLevelNumber = index;
		const level = levelMap.get(itemId)!;
		// Only update if the level number is changing
		if (level.levelNumber !== newLevelNumber) {
			return SeasonLevel.update(
				{ levelNumber: newLevelNumber },
				{ where: { itemId: itemId } }
			);
		}
		return Promise.resolve();
	});
	
	await Promise.all(updatePromises);
	
	// Refresh season cache
	await seasonXp.refreshSeason();
	
	// Get updated levels
	const updatedLevels = await SeasonLevel.findAll({
		where: { seasonAttributeId: seasonConfig.seasonAttributeId },
		order: [['levelNumber', 'ASC']]
	});
	
	await logConfigChange({
		subTo: 'seasonLevels',
		action: 'reorder_season_levels',
		employeeId,
		details: {
			order: orderedItemIds,
			newLevelNumbers: updatedLevels.map(l => ({ itemId: l.itemId, levelNumber: l.levelNumber }))
		}
	});
	
	return {
		success: true,
		levels: updatedLevels.map(level => ({
			itemId: level.itemId,
			levelNumber: level.levelNumber,
			minPoints: level.minPoints,
			maxPoints: level.maxPoints,
			description: level.description,
			textColor: level.textColor,
			accentColor: level.accentColor,
			textAccentColor: level.textAccentColor,
			cardBgImage: level.cardBgImage,
			bgColor: level.bgColor,
			bgImage: level.bgImage
		}))
	};
}


import SeasonConfig from '../../common/database/configModels/seasonConfig';
import SeasonLevel from '../../common/database/configModels/seasonLevels';
import SeasonPuzzlePoints from '../../common/database/configModels/seasonPuzzlePoints';
import SeasonQuestionPoints from '../../common/database/configModels/seasonQuestionPoints';
import { userDb } from '../../common/database/connections';
import Account from '../../common/database/userModels/account';
import ItemHistory from '../../common/database/userModels/itemHistory';
import logger from '../../common/logger';
import redis from '../../common/redisClient';
import rKey from '../../common/redisKeys';
import RedisSeasonConfig from '../../common/types/redisSeasonConfig';
import RedisSeasonLevel from '../../common/types/redisSeasonLevel';
import { bulkCacheUsers } from '../../common/utils/userGetters';
import { levelsWithMaxPoints } from '../../websocket/helpers/bulkPlayerMethods';
import getSeason from '../utils/getSeason';

export async function getSeasonSettings() {
	const season = await getSeason();
	if (season) {
		return {
			name: season.seasonName,
			pointsEarnedOverlayDelayMs: 3000,
			pointsEarnedOverlayDurationMs: 6000,
			quotas: {
				currentReferrals: 0,
				currentSharesToFacebook: 0,
				currentSharesToTwitter: 0,
				maxReferrals: 0,
				maxSharesToFacebook: 0,
				maxSharesToTwitter: 0,
			},
			rewards: {
				referral: 0,
				shareToFacebook: 0,
				shareToTwitter: 0,
			}
		}
	} else return {};
}

export async function getSeasonLevels(userXp: number = 0) {
	const season = await getSeason();
	if (season) {
		return [
			{
				active: true,
				name: season.seasonName,
				state: 'active',
				levels: levelsWithMaxPoints(season.levels, userXp),
				infoText: season.disclaimer
			}
		]
	} else return [];
}

export async function refreshSeason() {
	const constructSeasonConfig = (config: SeasonConfig): RedisSeasonConfig => {
		const configObj: RedisSeasonConfig = {
			seasonId: config.seasonId,
			seasonName: config.seasonName,
			startDate: config.startDate.toISOString(),
			endDate: config.endDate.toISOString(),
			tentpoleEnabled: config.tentpoleEnabled.toString(),
			finalePrizeCents: config.finalePrizeCents.toString(),
			howItWorks: config.howItWorks,
			disclaimer: config.disclaimer
		};
		// Only include tentpoleEnabled_android if it's not null/undefined
		if (config.tentpoleEnabled_android != null) {
			configObj.tentpoleEnabled_android = config.tentpoleEnabled_android;
		}
		return configObj;
	}
	const constructLevels = (levels: SeasonLevel[]): RedisSeasonLevel[] => {
		return levels.map(l => ({
			level: l.levelNumber,
			minPoints: l.minPoints,
			maxPoints: l.maxPoints,
			display: {
				description: l.description,
				textColor: l.textColor,
				accentColor: l.accentColor,
				textAccentColor: l.textAccentColor,
				cardBackgroundImage: l.cardBgImage,
				backgroundColor: l.bgColor,
				backgroundImage: l.bgImage
			}
		}));
	}
	// First check if there's an enabled season before clearing cache
	// Note: enabled is a TINYINT (0 or 1), not a boolean
	const seasonConfig = await SeasonConfig.findOne({ where: { enabled: 1 } });
	
	if (!seasonConfig) {
		// Log for debugging - check if any seasons exist at all
		const allSeasons = await SeasonConfig.findAll({ limit: 5 });
		logger.warn({ 
			enabledSeasonCount: 0,
			totalSeasonsFound: allSeasons.length,
			seasonIds: allSeasons.map(s => ({ id: s.seasonId, enabled: s.enabled }))
		}, 'No enabled season found in refreshSeason');
	}
	
	const multi = redis.multi();
	
	if (seasonConfig) {
		logger.info({ seasonId: seasonConfig.seasonId, seasonName: seasonConfig.seasonName }, 'Refreshing season cache');
		// Only clear cache if we have a season to repopulate it with
		multi.del(rKey.seasonConfig)
			.del(rKey.seasonLevels)
			.del(rKey.questionPoints)
			.del(rKey.puzzlePoints);
		
		const rSeasonConfig = constructSeasonConfig(seasonConfig);
		multi.hSet(rKey.seasonConfig, rSeasonConfig);

		const levels = await SeasonLevel.findAll({ where: { seasonAttributeId: seasonConfig.seasonAttributeId } });
		if (levels.length > 0) {
			const rLevels = constructLevels(levels);
			multi.json.set(rKey.seasonLevels, '$', rLevels);
		}

		const questionPoints = await SeasonQuestionPoints.findAll({ where: { seasonAttributeId: seasonConfig.seasonAttributeId } });
		if (questionPoints.length > 0) {
			const rQuestionPoints: Record<string, string> = {};
			questionPoints.forEach(l => {
				const key = l.questionNumber != null ? String(l.questionNumber) : 'rest';
				rQuestionPoints[key] = String(l.points);
			});
			multi.hSet(rKey.questionPoints, rQuestionPoints);
		}
		const puzzlePoints = await SeasonPuzzlePoints.findAll({ where: { seasonAttributeId: seasonConfig.seasonAttributeId } });
		if (puzzlePoints.length > 0) {
			const rPuzzlePoints: Record<string, string> = {};
			puzzlePoints.forEach(l => {
				const key = l.puzzleNumber != null ? String(l.puzzleNumber) : 'rest';
				rPuzzlePoints[key] = String(l.points);
			});
			multi.hSet(rKey.puzzlePoints, rPuzzlePoints);
		}
		
		const execResult = await multi.exec();
		// Check if Redis commands executed successfully
		// If execResult is null, the transaction was aborted
		if (!execResult) {
			logger.error('Redis multi.exec() returned null in refreshSeason - transaction aborted');
			throw new Error('Redis execution failed: transaction was aborted');
		}
	} else {
		// No enabled season - clear cache to remove stale data
		multi.del(rKey.seasonConfig)
			.del(rKey.seasonLevels)
			.del(rKey.questionPoints)
			.del(rKey.puzzlePoints);
		await multi.exec();
	}

	const season = await getSeason();
	// 'reset' seasonxp
	await userDb.transaction(async transaction => {
        await ItemHistory.update({ counted: false }, { where: { item: 'seasonXp' }, transaction });
		if (season) {
			await ItemHistory.update({ counted: true }, { where: { seasonId: season.seasonId, item: 'seasonXp' }, transaction }); // if an existing season is restored
		}
    });
	
	// refresh all users
	const userIds = (await Account.findAll({ attributes: ['id'] })).map(a => a.id);
	await bulkCacheUsers(userIds);
	
	return {
		season: season,
		questionPoints: await redis.hGetAll(rKey.questionPoints),
		puzzlePoints: await redis.hGetAll(rKey.puzzlePoints)
	}
}

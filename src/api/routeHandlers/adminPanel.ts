import { Upload } from '@aws-sdk/lib-storage';
import { Request } from 'express';
import sharp from 'sharp';
import Audit from '../../common/database/adminModels/audit';
import Show from '../../common/database/configModels/show';
import Game from '../../common/database/eventModels/game';
import Schedule from '../../common/database/eventModels/schedule';
import Account from '../../common/database/userModels/account';
import ItemHistory from '../../common/database/userModels/itemHistory';
import Keychain from '../../common/database/userModels/keychain';
import HqError from '../../common/hqError';
import HqId from '../../common/hqId';
import redis from '../../common/redisClient';
import s3 from '../../common/s3';
import CompletedOffairGame from '../../common/database/userModels/completedOffairGame';
import Payout from '../../common/database/userModels/payout';
import Win from '../../common/database/userModels/win';
import { Op, QueryTypes } from 'sequelize';
import ms from 'ms';
import rKey from '../../common/redisKeys';
import generateSchedule from '../utils/generateSchedule';
import defaultAvatars from '../defaultAvatars';
import { userDb } from '../../common/database/connections';
import { getTimeZones } from '@vvo/tzdb';

export async function getSchedule() {
	return await Schedule.findAll({
        order: [ ['startTime', 'ASC'] ],
    });
}

export async function getShowType(specifiedShowType: string) {
	const showDisplay = specifiedShowType != "all" ? await Show.findOne({ where: { showType: specifiedShowType } }) : await Show.findAll({ limit: 20 });
    return showDisplay;
}

export async function getShowTypesBatch(showTypes: string[]): Promise<Record<string, any>> {
	if (!Array.isArray(showTypes) || showTypes.length === 0) {
		return {};
	}

	// Limit batch size to prevent abuse
	const MAX_BATCH_SIZE = 100;
	
	// Validate and sanitize show types - only allow alphanumeric strings with underscores/hyphens
	const limitedShowTypes = showTypes
		.slice(0, MAX_BATCH_SIZE)
		.map(type => {
			// Ensure it's a string
			const typeStr = String(type);
			// Only allow alphanumeric, underscore, and hyphen (common show type format)
			// This prevents injection attacks
			if (!/^[a-zA-Z0-9_-]+$/.test(typeStr)) {
				return null;
			}
			return typeStr;
		})
		.filter((type): type is string => type !== null);
	
	// If no valid show types after filtering, return empty result
	if (limitedShowTypes.length === 0) {
		return {};
	}

	// Deduplicate show types
	const uniqueShowTypes = Array.from(new Set(limitedShowTypes));

	// Fetch all unique show types in a single query
	const shows = await Show.findAll({
		where: { showType: { [Op.in]: uniqueShowTypes } },
		raw: true
	});

	// Create a map for quick lookup
	const showMap: Record<string, any> = {};
	shows.forEach(show => {
		showMap[show.showType] = show;
	});

	// Return results for all requested show types (including duplicates)
	const result: Record<string, any> = {};
	limitedShowTypes.forEach(showType => {
		if (showMap[showType]) {
			result[showType] = showMap[showType];
		} else {
			result[showType] = null;
		}
	});

	return result;
}
export async function createShow(employeeId: string, body: Request['body']) {
	const existingShow = await Show.findOne({ where: { showType: body.showType } });
    if (existingShow) throw new HqError('Show already exists.', 0, 409);
    
    const newShow = await Show.create({
        showType: body.showType,
        gameType: body.gameType,
        vertical: body.vertical,
        gameKey: body.gameKey,
        title: body.title,
        summary: body.summary,
        accentColor: body.accentColor,
        description: body.description,
        logoUrl: body.logoUrl,
        bgImageUrl: body.bgImageUrl,
        bgVideoUrl: body.bgVideoUrl,
        defaultOpt: body.defaultOpt ?? null,
        alwaysVisible: body.alwaysVisible,
        order: body.order ?? null
    });
    
    await Audit.create({
        to: body.showType,
        toType: 'show',
        from: employeeId,
        fromType: 'employee',
        action: 'create_show',
        description: 'Created show'
    });
    
    // Clear schedule cache before regenerating
    await Promise.all([
        redis.del(rKey.schedule('normal')),
        redis.del(rKey.schedule('rehearsal')),
        redis.del(rKey.schedule('all')),
		redis.set(rKey.scheduleLastEdited, new Date().toISOString())
    ]);
    
    // Regenerate schedules
    generateSchedule('normal', true);
    generateSchedule('rehearsal', true);
    generateSchedule('all', true);
    return newShow;
}

export async function updateShowType(specifiedShowType: string, body: Request['body']) {
	const showDisplay = await Show.findOne({ where: { showType: specifiedShowType } });
    if (!showDisplay) throw new HqError('Game not found.', 0, 404);
    const newShow = await Show.update({
        gameType: body.gameType,
        vertical: body.vertical,
        gameKey: body.gameKey,
        title: body.title,
        summary: body.summary,
        accentColor: body.accentColor,
        description: body.description,
        logoUrl: body.logoUrl,
        bgImageUrl: body.bgImageUrl,
        bgVideoUrl: body.bgVideoUrl,
        defaultOpt: body.defaultOpt,
        alwaysVisible: body.alwaysVisible,
        order: body.order,
		hidden: body.hidden
    }, { where: { showType: specifiedShowType } });
    
    // Clear schedule cache before regenerating
    await Promise.all([
        redis.del(rKey.schedule('normal')),
        redis.del(rKey.schedule('rehearsal')),
        redis.del(rKey.schedule('all')),
		redis.set(rKey.scheduleLastEdited, new Date().toISOString())
    ]);
    
    // Regenerate schedules
    generateSchedule('normal', true);
    generateSchedule('rehearsal', true);
    generateSchedule('all', true);
    return newShow
}

export async function deleteShow(showType: string, employeeId: string) {
	const show = await Show.findOne({ where: { showType } });
	if (!show) throw new HqError('Show not found.', 0, 404);
	
	// Check if there are any games using this show type
	const game = await Game.findOne({ where: { showType } });
	if (game) throw new HqError('Cannot delete a show that has games associated with it', 0, 400);
	
	await Promise.all([
		Show.destroy({ where: { showType }, limit: 1 }),
		Audit.create({
			to: showType,
			toType: 'show',
			from: employeeId,
			fromType: 'employee',
			action: 'delete_show',
			description: 'Deleted show'
		})
	]);
	
	// Clear schedule cache before regenerating
	await Promise.all([
		redis.del(rKey.schedule('normal')),
		redis.del(rKey.schedule('rehearsal')),
		redis.del(rKey.schedule('all')),
		redis.set(rKey.scheduleLastEdited, new Date().toISOString())
	]);
	
	// Regenerate schedules since show configuration changed
	generateSchedule('normal', true);
	generateSchedule('rehearsal', true);
	generateSchedule('all', true);
	
	return { success: true };
}

export async function updateAvatarFromAP(userIdStr: string, employeeId: string, body: Request['body'], headers: Request['headers']) {
	const user = await Account.findOne({ where: { id: userIdStr } });
    if (!user) throw new HqError('User not found', 0, 404);
    if (!body) throw new HqError('Avatar is required', 0, 400);
    if (!["png", "jpg", "jpeg", "heif", "avif", "webp", "gif", "tiff", "svg"].includes((headers?.["content-type"]??"").split("/")[1])) throw new HqError('Not an image.', 0, 400);

    const compressed = await sharp(body).resize({ height: 512, width: 512 }).jpeg({ quality: 20 }).toBuffer();
    
    const avatarId = new HqId().avatar();
    await new Upload({
        client: s3,
        params: {
            Bucket: process.env.S3_BUCKET ?? "anolet",
            Key: `hqtv/a/${avatarId}.jpg`,
            Body: compressed
        }
    }).done();

    await Account.update({ avatarUrl: `${process.env.CDN_URL}/hqtv/a/${avatarId}.jpg` }, { where: { id: userIdStr } });
    await Audit.create({
        to: userIdStr,
        toType: 'account',
        from: employeeId,
        fromType: 'employee',
        action: 'set_avatar',
        description: 'Changed avatar'
    });
    await redis.del(rKey.user(+userIdStr));
    return {};
}

export async function deleteAvatarFromAP(userIdStr: string, employeeId: string) {
    const user = await Account.findOne({ where: { id: userIdStr } });
    if (!user) throw new HqError('User not found', 0, 404);
    const randomAvatar = defaultAvatars[Math.floor(Math.random() * defaultAvatars.length)];
    await Account.update({ avatarUrl: randomAvatar }, { where: { id: userIdStr } });
    await Audit.create({
        to: userIdStr,
        toType: 'account',
        from: employeeId,
        fromType: 'employee',
        action: 'delete_avatar',
        description: 'Deleted avatar'
    });
    await redis.del(rKey.user(+userIdStr));
    return { avatarUrl: randomAvatar };
}

export async function getMetrics() {
	const ts = Date.now();
    const accountCount = await Account.count({ where: { id: { [Op.ne]: 2 } } });
	
	async function getAllTimeDailyRegistrations() {
		// Find the oldest user's creation date (excluding user ID 2)
		const oldestUser = await Account.findOne({
			where: { id: { [Op.ne]: 2 } },
			order: [['created', 'ASC']],
			attributes: ['created']
		});
		
		if (!oldestUser || !oldestUser.created) {
			// No users exist, return empty array
			return [];
		}
		
		const oldestDate = new Date(oldestUser.created);
		// Set to start of day
		oldestDate.setHours(0, 0, 0, 0);
		
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		
		// Fetch all accounts with their creation dates (excluding user ID 2)
		const allAccounts = await Account.findAll({
			where: { id: { [Op.ne]: 2 } },
			attributes: ['created'],
			order: [['created', 'ASC']]
		});
		
		// Group registrations by day
		const dailyMap = new Map<string, number>();
		
		// Initialize all days from oldest to today with 0 counts
		const daysDiff = Math.ceil((today.getTime() - oldestDate.getTime()) / (1000 * 60 * 60 * 24));
		for (let i = 0; i <= daysDiff; i++) {
			const day = new Date(oldestDate);
			day.setDate(day.getDate() + i);
			const dayKey = day.toISOString().split('T')[0]; // YYYY-MM-DD format
			dailyMap.set(dayKey, 0);
		}
		
		// Count registrations per day (user ID 2 already excluded from query)
		allAccounts.forEach(account => {
			if (!account.created) return;
			const accountDate = new Date(account.created);
			accountDate.setHours(0, 0, 0, 0);
			const dayKey = accountDate.toISOString().split('T')[0];
			const currentCount = dailyMap.get(dayKey) || 0;
			dailyMap.set(dayKey, currentCount + 1);
		});
		
		// Convert map to array in chronological order
		const dailyCounts: number[] = [];
		for (let i = 0; i <= daysDiff; i++) {
			const day = new Date(oldestDate);
			day.setDate(day.getDate() + i);
			const dayKey = day.toISOString().split('T')[0];
			dailyCounts.push(dailyMap.get(dayKey) || 0);
		}
		
		return dailyCounts;
	}

	async function getOnlineUserCounts() {
		const now = Date.now();
		const windows = [
			{ key: 'pastHour' as const, ms: ms('1 hour') },
			{ key: 'past24Hours' as const, ms: ms('24 hours') },
			{ key: 'past3Days' as const, ms: ms('3 days') },
			{ key: 'past7Days' as const, ms: ms('7 days') },
			{ key: 'pastMonth' as const, ms: ms('30 days') },
		];
		const counts = {
			pastHour: 0,
			past24Hours: 0,
			past3Days: 0,
			past7Days: 0,
			pastMonth: 0,
		};
		const batch: string[] = [];
		const BATCH_SIZE = 500;

		async function flushBatch() {
			if (batch.length === 0) return;
			const keys = batch.splice(0, batch.length);
			const values = await redis.mGet(keys);
			values.forEach((value) => {
				if (!value) return;
				const timestamp = Date.parse(value);
				if (!Number.isFinite(timestamp)) return;
				const age = now - timestamp;
				windows.forEach(({ key, ms }) => {
					if (age <= ms) {
						counts[key]++;
					}
				});
			});
		}

		for await (const key of redis.scanIterator({ MATCH: 'userRequestMeta:lastOnline:*', COUNT: 1000 })) {
			batch.push(key as string);
			if (batch.length >= BATCH_SIZE) {
				await flushBatch();
			}
		}

		await flushBatch();

		return counts;
	}

	let timezoneAliasMap: Map<string, string> | null = null;

	function buildTimezoneAliasMap(): Map<string, string> {
		if (timezoneAliasMap) {
			return timezoneAliasMap;
		}
		
		timezoneAliasMap = new Map();
		const timezones = getTimeZones();
		
		for (const tz of timezones) {
			const canonicalName = tz.name;
			if (tz.group && Array.isArray(tz.group)) {
				for (const alias of tz.group) {
					if (alias !== canonicalName) {
						timezoneAliasMap.set(alias, canonicalName);
					}
				}
			}
			timezoneAliasMap.set(canonicalName, canonicalName);
		}
		
		const etcAliases: Record<string, string> = {
			'Etc/GMT+0': 'UTC',
			'Etc/GMT-0': 'UTC',
			'Etc/UTC': 'UTC',
			'Etc/Universal': 'UTC',
			'Etc/Zulu': 'UTC',
		};
		
		for (const [alias, canonical] of Object.entries(etcAliases)) {
			timezoneAliasMap.set(alias, canonical);
		}
		
		return timezoneAliasMap;
	}

	function normalizeTimezone(timezone: string): string {
		try {
			const aliasMap = buildTimezoneAliasMap();
			return aliasMap.get(timezone) || timezone;
		} catch {
			return timezone;
		}
	}

	async function getRequestHeaderCounts() {
		const counts = {
			xHqClient: {} as Record<string, number>,
			country: {} as Record<string, number>,
			timezone: {} as Record<string, number>,
			lang: {} as Record<string, number>
		};
		const batch: string[] = [];
		const BATCH_SIZE = 500;

		function getHeaderValue(headers: string[], headerName: string): string | undefined {
			const idx = headers.indexOf(headerName);
			if (idx === -1 || idx + 1 >= headers.length) return undefined;
			return headers[idx + 1];
		}

		async function flushBatch() {
			if (batch.length === 0) return;
			const keys = batch.splice(0, batch.length);
			const values = await redis.mGet(keys);
			values.forEach((value) => {
				if (!value) return;
				try {
					const headers = JSON.parse(value) as string[];
					const client = getHeaderValue(headers, 'x-hq-client');
					const rawCountry = getHeaderValue(headers, 'x-hq-country');
					const timezone = getHeaderValue(headers, 'x-hq-timezone');
					const lang = getHeaderValue(headers, 'x-hq-lang');

					if (client) counts.xHqClient[client] = (counts.xHqClient[client] || 0) + 1;
					if (rawCountry) {
						const country = rawCountry.toLowerCase();
						if (country !== '--') {
							counts.country[country] = (counts.country[country] || 0) + 1;
						}
					}
					if (timezone) {
						const normalizedTimezone = normalizeTimezone(timezone);
						counts.timezone[normalizedTimezone] = (counts.timezone[normalizedTimezone] || 0) + 1;
					}
					if (lang) counts.lang[lang] = (counts.lang[lang] || 0) + 1;
				} catch {
					// Skip invalid JSON
				}
			});
		}

		for await (const key of redis.scanIterator({ MATCH: 'userRequestMeta:rawHeaders:*', COUNT: 1000 })) {
			batch.push(key as string);
			if (batch.length >= BATCH_SIZE) {
				await flushBatch();
			}
		}

		await flushBatch();

		return counts;
	}

	const [onlineUsers, headerCounts] = await Promise.all([
		getOnlineUserCounts(),
		getRequestHeaderCounts()
	]);

    const sinceSevenDays = new Date(ts - ms('7 days'));
    const sinceTwentyFourHours = new Date(ts - ms('24 hours'));
    const dayMs = ms('1 day');

    const [
        totalDailyChallengeGames,
        perfectDailyChallengeGames,
        uniqueDailyChallengePlayers,
        recentDailyChallengeGamesRaw,
        totalQuestionsCorrectAllTimeRaw,
        totalQuestionsAllTimeRaw,
        totalPointsEarnedAllTimeRaw,
        totalCoinsEarnedAllTimeRaw,
    ] = await Promise.all([
        CompletedOffairGame.count({ where: { userId: { [Op.ne]: 2 } } }),
        CompletedOffairGame.count({ where: { questionsIncorrect: 0, userId: { [Op.ne]: 2 } } }),
        CompletedOffairGame.count({ distinct: true, col: 'userId', where: { userId: { [Op.ne]: 2 } } }),
        CompletedOffairGame.findAll({
            attributes: [
                'userId',
                'started',
                'finished',
                'pointsEarned',
                'coinsEarned',
                'questionCount',
                'questionsCorrect',
                'questionsIncorrect',
            ],
            where: { finished: { [Op.gt]: sinceSevenDays }, userId: { [Op.ne]: 2 } },
            raw: true,
        }),
        CompletedOffairGame.sum('questionsCorrect', { where: { userId: { [Op.ne]: 2 } } }),
        CompletedOffairGame.sum('questionCount', { where: { userId: { [Op.ne]: 2 } } }),
        CompletedOffairGame.sum('pointsEarned', { where: { userId: { [Op.ne]: 2 } } }),
        CompletedOffairGame.sum('coinsEarned', { where: { userId: { [Op.ne]: 2 } } }),
    ]);

    const totalQuestionsCorrectAllTime = Number(totalQuestionsCorrectAllTimeRaw ?? 0);
    const totalQuestionsAllTime = Number(totalQuestionsAllTimeRaw ?? 0);
    const totalPointsEarnedAllTime = Number(totalPointsEarnedAllTimeRaw ?? 0);
    const totalCoinsEarnedAllTime = Number(totalCoinsEarnedAllTimeRaw ?? 0);

    const [medianDurationRow] = await userDb.query<{ medianDurationMs: string | number }>(
        `
        SELECT AVG(duration_ms) AS medianDurationMs
        FROM (
            SELECT
                TIMESTAMPDIFF(MICROSECOND, started, finished) / 1000.0 AS duration_ms,
                ROW_NUMBER() OVER (ORDER BY TIMESTAMPDIFF(MICROSECOND, started, finished)) AS row_num,
                COUNT(*) OVER () AS total_rows
            FROM completedOffairGame
            WHERE finished IS NOT NULL
              AND started IS NOT NULL
              AND TIMESTAMPDIFF(MICROSECOND, started, finished) >= 0
              AND userId != 2
        ) ranked
        WHERE row_num IN (
            FLOOR((total_rows + 1) / 2),
            CEIL((total_rows + 1) / 2)
        );
        `,
        { type: QueryTypes.SELECT },
    );
    const medianDurationMsAllTime = Math.round(
        Number(medianDurationRow?.medianDurationMs ?? 0),
    );

    const recentDailyChallengeGames = recentDailyChallengeGamesRaw.map((game) => ({
        ...game,
        started: new Date(game.started),
        finished: new Date(game.finished),
    }));

    const last24HourDailyChallengeGames = recentDailyChallengeGames.filter(
        (game) => game.finished >= sinceTwentyFourHours,
    );

    const totalCorrectLast24h = last24HourDailyChallengeGames.reduce(
        (sum, game) => sum + (game.questionsCorrect ?? 0),
        0,
    );
    const totalQuestionsLast24h = last24HourDailyChallengeGames.reduce(
        (sum, game) => sum + (game.questionCount ?? 0),
        0,
    );
    const totalPointsLast24h = last24HourDailyChallengeGames.reduce(
        (sum, game) => sum + (game.pointsEarned ?? 0),
        0,
    );
    const totalCoinsLast24h = last24HourDailyChallengeGames.reduce(
        (sum, game) => sum + (game.coinsEarned ?? 0),
        0,
    );

    const uniquePlayersLast24h = new Set(last24HourDailyChallengeGames.map((game) => game.userId)).size;
    const perfectGamesLast24h = last24HourDailyChallengeGames.filter(
        (game) => (game.questionsIncorrect ?? 0) === 0,
    ).length;

    function calculateMedian(values: number[]): number {
        if (!values.length) return 0;
        const sorted = values.slice().sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        if (sorted.length % 2 === 0) {
            return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
        }
        return Math.round(sorted[mid]);
    }

    const medianDurationMsLast24h = calculateMedian(
        last24HourDailyChallengeGames.map((game) =>
            Math.max(0, game.finished.getTime() - game.started.getTime()),
        ),
    );

    const nowDate = new Date(ts);
    const startOfToday = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate()));
    const dayBuckets = Array.from({ length: 7 }, (_, idx) => {
        const start = startOfToday.getTime() - (6 - idx) * dayMs;
        const end = start + dayMs;
        return {
            start,
            end,
            date: new Date(start).toISOString().slice(0, 10),
            completions: 0,
            perfectCompletions: 0,
            userIds: new Set<number>(),
        };
    });

    recentDailyChallengeGames.forEach((game) => {
        const finishedTs = game.finished.getTime();
        for (const bucket of dayBuckets) {
            if (finishedTs >= bucket.start && finishedTs < bucket.end) {
                bucket.completions += 1;
                if ((game.questionsIncorrect ?? 0) === 0) {
                    bucket.perfectCompletions += 1;
                }
                bucket.userIds.add(game.userId);
                break;
            }
        }
    });

    const playerParticipationByDay = new Map<number, Set<string>>();
    dayBuckets.forEach((bucket) => {
        const dateLabel = bucket.date;
        bucket.userIds.forEach((userId) => {
            if (!playerParticipationByDay.has(userId)) {
                playerParticipationByDay.set(userId, new Set());
            }
            playerParticipationByDay.get(userId)!.add(dateLabel);
        });
    });

    const orderedDates = dayBuckets.map((bucket) => bucket.date);

    const streakCounts = new Map<number, number>();
    let playersWithStreak2Plus = 0;
    let playersWithStreak3Plus = 0;

    playerParticipationByDay.forEach((datesSet) => {
        let longestStreak = 0;
        let currentStreak = 0;
        orderedDates.forEach((dateLabel) => {
            if (datesSet.has(dateLabel)) {
                currentStreak += 1;
                longestStreak = Math.max(longestStreak, currentStreak);
            } else {
                currentStreak = 0;
            }
        });
        if (longestStreak >= 2) playersWithStreak2Plus += 1;
        if (longestStreak >= 3) playersWithStreak3Plus += 1;
        streakCounts.set(longestStreak, (streakCounts.get(longestStreak) ?? 0) + 1);
    });

    const repeatPlayersLast7Days = playersWithStreak2Plus;

    const streakDistribution = Array.from(streakCounts.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([streakLength, count]) => ({ streakLength, count }));

    const activeUsersPast24h = onlineUsers.past24Hours ?? 0;
    const participationRateLast24h =
        activeUsersPast24h > 0 ? uniquePlayersLast24h / activeUsersPast24h : 0;

    const averageQuestionsCorrectAllTime = totalDailyChallengeGames
        ? totalQuestionsCorrectAllTime / totalDailyChallengeGames
        : 0;
    const averageAccuracyAllTime = totalQuestionsAllTime
        ? totalQuestionsCorrectAllTime / totalQuestionsAllTime
        : 0;
    const averagePointsEarnedAllTime = totalDailyChallengeGames
        ? totalPointsEarnedAllTime / totalDailyChallengeGames
        : 0;
    const averageCoinsEarnedAllTime = totalDailyChallengeGames
        ? totalCoinsEarnedAllTime / totalDailyChallengeGames
        : 0;
    const participationRateAllTime =
        accountCount > 0 ? uniqueDailyChallengePlayers / accountCount : 0;

    // Get all admin user IDs to exclude from circulation metrics
    const adminUsers = await Account.findAll({
        where: { admin: 1 },
        attributes: ['id'],
        raw: true
    });
    const adminUserIds = adminUsers.map(user => user.id);

    // Build where clause for circulation metrics excluding admin users
    const circulationWhereBase = {
        counted: true,
        ...(adminUserIds.length > 0 && { userId: { [Op.notIn]: adminUserIds } })
    };

    return {
        users: {
            now: accountCount ?? 0,
            past: await getAllTimeDailyRegistrations(),
        },
        onlineUsers,
        xHqClient: headerCounts.xHqClient,
        xHqCountry: headerCounts.country,
        xHqTimezone: headerCounts.timezone,
        xHqLang: headerCounts.lang,
        circulation: {
            coins: await ItemHistory.sum('qty', { where: { ...circulationWhereBase, item: "coins" }}) ?? 0,
            lives: await ItemHistory.sum('qty', { where: { ...circulationWhereBase, item: "lives" }}) ?? 0,
            erasers: await ItemHistory.sum('qty', { where: { ...circulationWhereBase, item: "erasers" }}) ?? 0,
            superSpins: await ItemHistory.sum('qty', { where: { ...circulationWhereBase, item: "superSpins" }}) ?? 0,
            seasonXp: await ItemHistory.sum('qty', { where: { ...circulationWhereBase, item: "seasonXp" }}) ?? 0,
        },
        dailyChallenge: {
            totalGames: totalDailyChallengeGames ?? 0,
            perfectGames: perfectDailyChallengeGames ?? 0,
            uniquePlayers: uniqueDailyChallengePlayers ?? 0,
            allTime: {
                participationRate: participationRateAllTime,
                averageQuestionsCorrect: averageQuestionsCorrectAllTime,
                averageAccuracy: averageAccuracyAllTime,
                medianDurationMs: medianDurationMsAllTime,
                averagePointsEarned: averagePointsEarnedAllTime,
                averageCoinsEarned: averageCoinsEarnedAllTime,
            },
            last24h: {
                completions: last24HourDailyChallengeGames.length,
                uniquePlayers: uniquePlayersLast24h,
                perfectCompletions: perfectGamesLast24h,
                participationRate: participationRateLast24h,
                averageQuestionsCorrect: last24HourDailyChallengeGames.length
                    ? totalCorrectLast24h / last24HourDailyChallengeGames.length
                    : 0,
                averageAccuracy: totalQuestionsLast24h ? totalCorrectLast24h / totalQuestionsLast24h : 0,
                medianDurationMs: medianDurationMsLast24h,
                averagePointsEarned: last24HourDailyChallengeGames.length
                    ? totalPointsLast24h / last24HourDailyChallengeGames.length
                    : 0,
                averageCoinsEarned: last24HourDailyChallengeGames.length
                    ? totalCoinsLast24h / last24HourDailyChallengeGames.length
                    : 0,
            },
            last7d: {
                completions: recentDailyChallengeGames.length,
                uniquePlayers: new Set(recentDailyChallengeGames.map((game) => game.userId)).size,
                repeatPlayers: repeatPlayersLast7Days,
                completionsByDay: dayBuckets.map((bucket) => ({
                    date: bucket.date,
                    completions: bucket.completions,
                    perfectCompletions: bucket.perfectCompletions,
                    uniquePlayers: bucket.userIds.size,
                })),
                repeatParticipation: {
                    streaks: streakDistribution,
                    playersWithStreak2Plus: playersWithStreak2Plus,
                    playersWithStreak3Plus: playersWithStreak3Plus,
                },
            },
        },
        payouts: {
            paid: await Payout.sum('amountCents', { where: { paid: 1, payoutEmail: { [Op.ne]: "GIVEBACK" } }}) ?? 0,
            unpaid: await Payout.sum('amountCents', { where: { paid: 0, payoutEmail: { [Op.ne]: "GIVEBACK" } }}) ?? 0,
            available: await Win.sum('prizeCents', { where: { frozen: 0, payoutId: null, winDate: { [Op.gt]: new Date(ts - ms('90 days')) } }}) ?? 0,
            frozen: await Win.sum('prizeCents', { where: { frozen: 1 }}) ?? 0,
            donated: await Payout.sum('amountCents', { where: { paid: 1, payoutEmail: "GIVEBACK" }}) ?? 0,
            forfeitedExpired: await Win.sum('prizeCents', { where: { frozen: 0, payoutId: null, winDate: { [Op.lt]: new Date(ts - ms('90 days')) } }}) ?? 0,
            totalWins: await Win.sum('prizeCents') ?? 0,
        }
    };
}

export async function getUsersTEMP(
	q: string | null,
	offset: number,
	filters?: {
		purged?: boolean;
		admin?: boolean;
		tester?: boolean;
		booster?: boolean;
		chatBan?: boolean;
		gameBan?: boolean;
		appBan?: boolean;
	},
	sort?: {
		sortBy?: 'name' | 'created' | 'id' | 'lastOnline';
		sortOrder?: 'ASC' | 'DESC';
	}
) {
	// Build where clause
	const whereClause: any = {};

	// Search query
	if (q != null && q.trim() !== '') {
		whereClause.name = { [Op.substring]: q.toLowerCase() };
	}

	// Filter by purged status
	if (filters?.purged !== undefined) {
		whereClause.purged = filters.purged ? 1 : 0;
	}

	// Filter by admin status
	if (filters?.admin !== undefined) {
		whereClause.admin = filters.admin ? 1 : 0;
	}

	// Filter by tester status
	if (filters?.tester !== undefined) {
		whereClause.tester = filters.tester ? 1 : 0;
	}

	// Filter by booster status
	if (filters?.booster !== undefined) {
		whereClause.booster = filters.booster ? 1 : 0;
	}

	// Filter by chat ban status
	if (filters?.chatBan !== undefined) {
		whereClause.chatBan = filters.chatBan ? 1 : 0;
	}

	// Filter by game ban status
	if (filters?.gameBan !== undefined) {
		whereClause.gameBan = filters.gameBan ? 1 : 0;
	}

	// Filter by app ban status
	if (filters?.appBan !== undefined) {
		whereClause.appBan = filters.appBan ? 1 : 0;
	}

	const sortBy = sort?.sortBy || 'created';
	const sortOrder = sort?.sortOrder || 'DESC';

	// Special handling for lastOnline sorting (stored in Redis, not database)
	if (sortBy === 'lastOnline') {
		// Fetch a larger batch of users to sort by last online
		// For performance, we limit to 1000 users when sorting by lastOnline
		const maxUsersForSort = 1000;
		
		const allUsers = await Account.findAll({
			where: whereClause,
			limit: maxUsersForSort
		});

		// Get last online timestamps from Redis for all users
		const userIds = allUsers.map(user => user.id).filter((id): id is number => id !== null && id !== undefined);
		
		if (userIds.length === 0) {
			return {
				data: [],
				hasMore: false
			};
		}

		// Batch fetch last online from Redis using mGet for better performance
		const lastOnlineKeys = userIds.map(userId => rKey.userLastOnline(userId));
		const lastOnlineValues = await redis.mGet(lastOnlineKeys);

		// Combine users with their last online timestamps
		const usersWithLastOnline = allUsers.map((user, index) => {
			const lastOnlineStr = lastOnlineValues[index];
			const lastOnline = lastOnlineStr ? new Date(lastOnlineStr).getTime() : 0;
			return {
				user,
				lastOnline
			};
		});

		// Sort by last online
		usersWithLastOnline.sort((a, b) => {
			if (sortOrder === 'DESC') {
				return b.lastOnline - a.lastOnline;
			} else {
				return a.lastOnline - b.lastOnline;
			}
		});

		// Apply pagination
		const startIndex = offset;
		const endIndex = offset + 21; // Fetch one extra to check if there are more
		const paginatedUsers = usersWithLastOnline.slice(startIndex, endIndex);
		const hasMore = paginatedUsers.length > 20;
		const results = hasMore ? paginatedUsers.slice(0, 20).map(item => item.user) : paginatedUsers.map(item => item.user);

		// Batch fetch pin statuses for all users
		const userIdsForPin = results.map(user => user.id).filter((id): id is number => id !== null && id !== undefined);
		const keychains = userIdsForPin.length > 0 ? await Keychain.findAll({
			where: { userId: { [Op.in]: userIdsForPin } },
			attributes: ['userId', 'pinHash']
		}) : [];

		// Create a map of userId -> hasPin
		const pinMap = new Map<number, number>();
		keychains.forEach(kc => {
			pinMap.set(kc.userId, kc.pinHash && kc.pinHash.trim() !== '' ? 1 : 0);
		});

		// Add pin field to each user
		const resultsWithPin = results.map(user => {
			const userObj = user.toJSON ? user.toJSON() : user;
			return {
				...userObj,
				pin: pinMap.get(user.id ?? 0) ?? 0
			};
		});

		return {
			data: resultsWithPin,
			hasMore: hasMore || allUsers.length >= maxUsersForSort
		};
	}

	// Standard database sorting for other fields
	const order: [string, string] = [sortBy, sortOrder];

	// Use consistent pagination limit of 20, fetch one extra to check if there are more results
	const limit = 21;

	const userResults = await Account.findAll({
		where: whereClause,
		order: [order],
		offset: offset,
		limit: limit
	});

	// Check if there are more results
	const hasMore = userResults.length > 20;
	
	// Return only 20 results (or less if that's all there is)
	const results = hasMore ? userResults.slice(0, 20) : userResults;

	// Batch fetch pin statuses for all users
	const userIds = results.map(user => user.id).filter((id): id is number => id !== null && id !== undefined);
	const keychains = userIds.length > 0 ? await Keychain.findAll({
		where: { userId: { [Op.in]: userIds } },
		attributes: ['userId', 'pinHash']
	}) : [];

	// Create a map of userId -> hasPin
	const pinMap = new Map<number, number>();
	keychains.forEach(kc => {
		pinMap.set(kc.userId, kc.pinHash && kc.pinHash.trim() !== '' ? 1 : 0);
	});

	// Add pin field to each user
	const resultsWithPin = results.map(user => {
		const userObj = user.toJSON ? user.toJSON() : user;
		return {
			...userObj,
			pin: pinMap.get(user.id ?? 0) ?? 0
		};
	});

	return {
		data: resultsWithPin,
		hasMore: hasMore
	};
}

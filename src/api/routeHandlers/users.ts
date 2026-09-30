import { Request } from 'express';
import { col, fn, Op, where } from 'sequelize';
import { all } from 'better-all';
import Audit from '../../common/database/adminModels/audit';
import Show from '../../common/database/configModels/show';
import { userDb } from '../../common/database/connections';
import Account from '../../common/database/userModels/account';
import GamePlayed from '../../common/database/userModels/gamesPlayed';
import ItemHistory from '../../common/database/userModels/itemHistory';
import Keychain from '../../common/database/userModels/keychain';
import LoginToken from '../../common/database/userModels/loginToken';
import Payout from '../../common/database/userModels/payout';
import Referral from '../../common/database/userModels/referral';
import HqError from '../../common/hqError';
import logger from '../../common/logger';
import redis from '../../common/redisClient';
import rKey from '../../common/redisKeys';
import User from '../../common/types/user';
import adjustItemBalance from '../../common/utils/adjustItemBalance';
import centsToDollars from '../../common/utils/centsToDollars';
import { getUser } from '../../common/utils/userGetters';
import defaultAvatars from '../defaultAvatars';
import getBalanceSummary from '../utils/getBalanceSummary';
import getGeneralConfig from '../utils/getGeneralConfig';
import newAuth from '../utils/newAuth';
import getProfileFull from '../utils/profileGetters/getProfileFull';

export async function verifyUsername(inputUsername: unknown, failStatus: number = 200) {
    const username = inputUsername?.toString(); // sanitise
    if (!username) {
        throw new HqError('username is required', 401, 400);
    }
    
    const containsInvalidChar = /[^a-z0-9_-]/i.test(username); // no whitespaces, emojis, etc.
    const similarUsername = username.replace('I', 'l');
    const otherSimilarUsername = username.replace('l', 'I');
    const [blacklist, userWithSameName] = await Promise.all([
        redis.sMembers('blacklistedNames'),
        Account.findOne({
            where: { [Op.or]: [ // name comparisons are non case-sensitive with mysql
                { name: username },
                { name: similarUsername },
                { name: otherSimilarUsername }
            ]}
        })
    ]);
    if (username.length > 21) {
        throw new HqError('The username is too long.', 471, failStatus);
    } else if (containsInvalidChar) {
        throw new HqError('The username contains an invalid character.', 472, failStatus);
    } else if (userWithSameName || blacklist.some(v => username.includes(v))) {
        throw new HqError('That username is not available', 101, failStatus);
    } else {
        return {};
    }
}

export async function verifyReferral(inputReferralCode: unknown, failStatus: number = 200) {
    // check if referral user exists
    const referralCode = (inputReferralCode ?? '').toString();
	const referralCodeUser = await Account.findOne({ where: { name: referralCode } });
    if (referralCodeUser) {
        return referralCodeUser;
    } else {
        throw new HqError('The referral code is not valid', 465, failStatus);
    }
}

export async function searchUser(q: string = '', offset: number = 0) {
	const userResults = await Account.findAll({
		where: { name: { [Op.substring]: q.toLowerCase() }, purged: false },
		offset: offset,
		limit: 20
	});
	const data = userResults.map(({ id, name, avatarUrl, created, booster }) => ({
		userId: id ?? 0,
		username: booster == 1 ? '⭐ ' + name : name,
		avatarUrl: avatarUrl,
		live: false,
		subscriberCount: 0,
		lastLive: null,
		featured: false,
		created: created ?? new Date()
	}));
	return data;
}

export async function getUserMetadata(userIdStr: string) {
    const [country, lastOnline, headersStr] = await Promise.all([
		redis.get(rKey.userCountry(+userIdStr)),
		redis.get(rKey.userLastOnline(+userIdStr)),
		redis.get(rKey.userRawHeaders(+userIdStr))
	]);
	const headers = headersStr ? JSON.parse(headersStr) : [];
	return {
		country: country ?? 'un',
		lastOnline: lastOnline ?? '',
		particulars: {
			client: headers[headers.indexOf('x-hq-client') + 1] ?? 'unknown',
			timezone: headers[headers.indexOf('x-hq-timezone') + 1] ?? 'unknown',
			device: headers[headers.indexOf('x-hq-device') + 1] ?? 'unknown',
			lang: headers[headers.indexOf('x-hq-lang') + 1] ?? 'unknown',
		}
	}
}

export async function getUserMetadataBatch(userIds: (string | number)[]): Promise<Record<string, any>> {
	if (!Array.isArray(userIds) || userIds.length === 0) {
		return {};
	}

	// Limit batch size to prevent abuse
	const MAX_BATCH_SIZE = 100;
	
	// Validate and sanitize user IDs - only allow numeric strings or numbers
	const limitedUserIds = userIds
		.slice(0, MAX_BATCH_SIZE)
		.map(id => {
			// Convert to number and validate
			const numId = typeof id === 'number' ? id : parseInt(String(id), 10);
			// Only allow positive integers
			if (isNaN(numId) || numId <= 0 || !Number.isInteger(numId)) {
				return null;
			}
			return numId;
		})
		.filter((id): id is number => id !== null);
	
	// If no valid IDs after filtering, return empty result
	if (limitedUserIds.length === 0) {
		return {};
	}

	// Batch fetch all metadata from Redis
	const countryKeys = limitedUserIds.map(id => rKey.userCountry(id));
	const lastOnlineKeys = limitedUserIds.map(id => rKey.userLastOnline(id));
	const headersKeys = limitedUserIds.map(id => rKey.userRawHeaders(id));

	const [countries, lastOnlines, headersStrs] = await Promise.all([
		redis.mGet(countryKeys),
		redis.mGet(lastOnlineKeys),
		redis.mGet(headersKeys)
	]);

	// Build result object
	const result: Record<string, any> = {};
	limitedUserIds.forEach((userId, index) => {
		const headersStr = headersStrs[index];
		let headers: any[] = [];
		
		// Safely parse headers JSON
		if (headersStr) {
			try {
				const parsed = JSON.parse(headersStr);
				headers = Array.isArray(parsed) ? parsed : [];
			} catch {
				// If parsing fails, use empty array
				headers = [];
			}
		}
		
		result[String(userId)] = {
			country: countries[index] ?? 'un',
			lastOnline: lastOnlines[index] ?? '',
			particulars: {
				client: headers[headers.indexOf('x-hq-client') + 1] ?? 'unknown',
				timezone: headers[headers.indexOf('x-hq-timezone') + 1] ?? 'unknown',
				device: headers[headers.indexOf('x-hq-device') + 1] ?? 'unknown',
				lang: headers[headers.indexOf('x-hq-lang') + 1] ?? 'unknown',
			}
		};
	});

	return result;
}

export async function getReferrals(userIdStr: string) {
    let [referrer, referrals] = await Promise.all([
		Referral.findOne({ where: { newUserId: userIdStr } }),
		Referral.findAll({ where: { referralUserId: userIdStr } })
	]);
    return {
		referrer: referrer,
		referrals: referrals,
	}
}

export async function createAccount(phone: string, inputUsername: unknown) {
	await verifyUsername(inputUsername, 400);
	const randomAvatar = defaultAvatars[Math.floor(Math.random() * defaultAvatars.length)];
	const newAccount = await userDb.transaction(async transaction => {
		const acc = await Account.create({ name: inputUsername, avatarUrl: randomAvatar }, { transaction });
		await Keychain.create({ phone: phone, userId: acc.id }, { transaction });
		return acc;
	});
	return newAccount;
}

export async function getProfile(requestedUser: User, requestingUser: User, requestedUserId: string = '') {
	const profile = await getProfileFull(requestedUser, requestingUser);
	if (requestedUserId === 'me') {
		// stuffs up username changing otherwise
		profile.username = requestedUser.actualName;
	}
	return profile;
}

export async function getBalance(userId: number) {
	const [balanceSummary, showDisplays, user] = await Promise.all([
		getBalanceSummary(userId),
		Show.findAll(),
		Account.findOne({ where: { id: userId } })
	]);

	type PayoutEligiblity = 'disallowed_not_enough' | 'disallowed_all_frozen' | 'allowed_fully' | 'allowed_partially' | 'disallowed_banned';
	let payoutEligibility: PayoutEligiblity;
	if (balanceSummary.eligibleForPayout) {
		if (balanceSummary.frozenCents === 0) {
			payoutEligibility = 'allowed_fully';
		} else {
			payoutEligibility = 'allowed_partially';
		}
	} else {
		if (balanceSummary.frozenWinIds.length > 0) {
			payoutEligibility = 'disallowed_all_frozen';
		} else {
			payoutEligibility = 'disallowed_not_enough';
		}
	}

	if (user?.gameBan) {
		payoutEligibility = 'disallowed_banned';
	}

	const recentWins = balanceSummary.wins.map(w => {
		const display = showDisplays.find(d => d.showType === w.showType);
		return {
			isFrozen: !!w.frozen,
			isForfeited: balanceSummary.forfeitedWinIds.includes(w.winId),
			prize: centsToDollars(w.prizeCents),
			title: display?.title,
			bgImage: display?.bgImageUrl,
			textColor: display?.accentColor,
			winDate: w.winDate
		}
	});

	return {
		payouts: [],
		balance: {
			prizeTotal: centsToDollars(balanceSummary.prizeTotalCents),
			paid: centsToDollars(balanceSummary.paidCents),
			pending: centsToDollars(balanceSummary.pendingCents),
			unpaid: centsToDollars(balanceSummary.unpaidCents),
			forfeited: centsToDollars(balanceSummary.forfeitedCents),
			available: centsToDollars(balanceSummary.availableCents),
			frozen: centsToDollars(balanceSummary.frozenCents),
			eligibleForPayout: balanceSummary.eligibleForPayout,
			winsReadyForCashout: balanceSummary.availableWinIds.length > 0,
			appealStatus: 'none',
			hasPending: balanceSummary.hasPending,
			payoutsConnected: false,
			payoutsEmail: null,
			documentRequired: false,
			documentStatus: 'none',
			payoutEligibility: payoutEligibility
		},
		recentWins: recentWins,
		charities: [{
			charityId: 'giveback',
			displayName: 'Give back to HQTV',
			charityIconUrl: process.env.CDN_URL + '/hqtv/hqtv-donate-circle.png'
		}]
	}
}

export async function getAuditForUser(userIdStr: string) {
	const audit = await Audit.findAll({
        where: { [Op.or]: [
            {
                to: userIdStr,
                toType: "account"
            },
            {
                from: userIdStr
            }
        ] },
        order: [
            ['date', 'DESC'],
        ],
    });
	return audit;
}

export async function grantExtraLife(targetId: number, count: number = 1, adminId: number) {
	await adjustItemBalance([targetId], { lives: count }, { reason: 'grant' });
	logger.info(`Granted lives. AdminID=${adminId}, TargetID=${targetId}, Count=${count}`);
	return {};
}

export async function getPhoneNumber(ofUserIdStr: string, accessingUser: { userId: number; } | { employeeId: string; }) {
    if ('userId' in accessingUser == false || +ofUserIdStr == accessingUser.userId) {
        // not the owner of the account
        await Audit.create({
            to: ofUserIdStr,
            toType: 'account',
            from: 'userId' in accessingUser ? accessingUser.userId : accessingUser.employeeId,
            fromType: 'userId' in accessingUser ? 'account' : 'employee',
            action: 'read_pii',
            description: 'Accessed phone number'
        });
    }
    return await Keychain.findOne({
        where: { userId: ofUserIdStr },
    });
}

export async function getGamesPlayed(userIdStr: string) {
	const gamesPlayed = await GamePlayed.findAll({
        where: { userId: userIdStr },
        order: [ ['created', 'DESC'] ],
    });
	return gamesPlayed;
}

export async function getItemHistory(userIdStr: string) {
	const itemHistory = await ItemHistory.findAll({
        where: { userId: userIdStr },
        order: [ ['date', 'DESC'] ]
    });
	return itemHistory;
}

export async function getPayouts(userIdStr: string) {
	const payouts = await Payout.findAll({
        where: { userId: userIdStr },
        order: [ ['created', 'DESC'] ]
    });
	return payouts;
}

export async function getItemHistoryDetails(itemHistoryIdStr: string) {
	const itemHistory = await ItemHistory.findOne({
        where: { id: itemHistoryIdStr },
    });
	return itemHistory;
}

export async function getRecentItemHistory() {
	const itemHistory = await ItemHistory.findAll({
        order: [ ['date', 'DESC'] ]
    });
	return itemHistory;
}

export async function tryToClaimMakeItRain(userr: User) {
	const now = Date.now();
	const { makeItRainEnabled, makeItRainIntervalSec } = await getGeneralConfig();
    if (!makeItRainEnabled) {
        throw new HqError('makeItRain disabled', 0, 400);
    }
    await userDb.transaction(async t => {
        // try to set lives first before setting cooldown on redis
        const user = await getUser(userr.id, true, t);
        await adjustItemBalance([user.id], { lives: 1 }, { reason: 'makeItRain' }, t);
    });
    // check eligiblity
    const claimSuccess = await redis.set(rKey.makeItRainClaim(userr.id), now, { EX: makeItRainIntervalSec, NX: true }); // locking mechanism
    if (claimSuccess) {
        return true;
    } else {
        return false;
    }
}

export async function makeItRainSuccess(user: User) {
	await getUser(user.id, true); // update
    logger.info(`MakeItRain claimed [UID=${user.id}]`)
    return { data: true };
}

export async function getAuthFromLoginToken(inputToken: unknown, headers: Request['headers'] = {}) {
	const loginToken = await LoginToken.findOne({
        where: { token: where(
            fn('BINARY', col('token')), // case sensitive
            inputToken?.toString()
        )}
    });
    if (!loginToken) {
        throw new HqError('invalid token', 406, 400);
    }

    const user = await getUser(loginToken.userId);
    const auth = await newAuth(user, loginToken.token, headers);
    logger.info(`Retrieved auth using login token. UserId=${user.id}`);
	return auth;
}

type ForensicsConnection = {
	userId: number;
	connectionType: 'deviceId' | 'ipAddress';
	connectionValue: string;
	path: number[]; // path from target user to source user (excluding source)
};

type ForensicsResult = {
	userId: number;
	linkedAccounts: ForensicsConnection[];
};

export async function getUserForensics(userIdStr: string, forceRefresh: boolean = false): Promise<ForensicsResult> {
	const userId = +userIdStr;
	
	const { cached, user } = await all({
		async cached() {
			return forceRefresh ? null : redis.get(rKey.userForensics(userId));
		},
		async user() {
			return Account.findOne({ where: { id: userId } });
		}
	});
	
	if (!user) {
		throw new HqError(`User not found: ${userId}`, 404, 404);
	}

	if (user.purged) {
		throw new HqError(`User is purged: ${userId}`, 404, 404);
	}
	
	if (cached) {
		return JSON.parse(cached);
	}

	// Graph traversal to find all linked accounts
	const visited = new Set<number>([userId]);
	const linkedAccounts = new Map<number, ForensicsConnection>();
	const queue: Array<{ userId: number; path: number[] }> = [{ userId, path: [] }];

	while (queue.length > 0) {
		const current = queue.shift()!;
		const currentUserId = current.userId;
		const currentPath = current.path;

		const { tokens, trackedIps } = await all({
			async tokens() {
				return LoginToken.findAll({
					where: {
						userId: currentUserId,
						[Op.or]: [
							{ xHqDeviceId: { [Op.ne]: null } },
							{ ipAddress: { [Op.ne]: null } }
						]
					}
				});
			},
			async trackedIps() {
				return redis.sMembers(rKey.userTrackedIps(currentUserId));
			}
		});

		// Collect unique device IDs and IP addresses from LoginToken
		const deviceIds = new Set<string>();
		const ipAddresses = new Set<string>();
		
		for (const token of tokens) {
			if (token.xHqDeviceId) {
				deviceIds.add(token.xHqDeviceId);
			}
			if (token.ipAddress) {
				ipAddresses.add(token.ipAddress);
			}
		}
		for (const ip of trackedIps) {
			if (ip) {
				ipAddresses.add(ip);
			}
		}

		// Find all users sharing these device IDs
		if (deviceIds.size > 0) {
			const deviceIdArray = Array.from(deviceIds);
			// Exclude already visited users to avoid redundant queries
			const visitedArray = Array.from(visited);
			const whereClause: any = {
				xHqDeviceId: { [Op.in]: deviceIdArray },
				userId: { [Op.ne]: currentUserId }
			};
			if (visitedArray.length > 0) {
				whereClause.userId[Op.notIn] = visitedArray;
			}
			const sharedDeviceTokens = await LoginToken.findAll({
				where: whereClause,
				attributes: ['userId', 'xHqDeviceId']
			});

			// Use a map to track unique user-device pairs and pick the first device ID for each user
			const userDeviceMap = new Map<number, string>();
			for (const token of sharedDeviceTokens) {
				if (token.xHqDeviceId && !userDeviceMap.has(token.userId)) {
					userDeviceMap.set(token.userId, token.xHqDeviceId);
				}
			}

			for (const [linkedUserId, deviceId] of userDeviceMap) {
				if (!visited.has(linkedUserId)) {
					visited.add(linkedUserId);
					const connection: ForensicsConnection = {
						userId: linkedUserId,
						connectionType: 'deviceId',
						connectionValue: deviceId,
						path: currentPath // path shows intermediate users (empty = direct connection)
					};
					linkedAccounts.set(linkedUserId, connection);
					queue.push({ userId: linkedUserId, path: [...currentPath, currentUserId] });
				}
			}
		}

		// Find all users sharing these IP addresses (from both LoginToken and tracked IPs)
		if (ipAddresses.size > 0) {
			const ipArray = Array.from(ipAddresses);
			
			// Find users via LoginToken IPs
			// Exclude already visited users to avoid redundant queries
			const visitedArray = Array.from(visited);
			const whereClause: any = {
				ipAddress: { [Op.in]: ipArray },
				userId: { [Op.ne]: currentUserId }
			};
			if (visitedArray.length > 0) {
				whereClause.userId[Op.notIn] = visitedArray;
			}
			const sharedIpTokens = await LoginToken.findAll({
				where: whereClause,
				attributes: ['userId', 'ipAddress']
			});

			// Find users via tracked IPs (using reverse index) - batch all redis calls
			const trackedIpUsersMap = new Map<number, string>();
			const ipUserResults = await Promise.all(
				ipArray.map(ip => redis.sMembers(rKey.ipToUsers(ip)).then(userIds => ({ ip, userIds })))
			);
			for (const { ip, userIds } of ipUserResults) {
				for (const userIdStr of userIds) {
					const linkedUserId = +userIdStr;
					// Exclude current user and already visited users
					if (linkedUserId !== currentUserId && !visited.has(linkedUserId) && !trackedIpUsersMap.has(linkedUserId)) {
						trackedIpUsersMap.set(linkedUserId, ip);
					}
				}
			}

			// Use a map to track unique user-IP pairs and pick the first IP for each user
			const userIpMap = new Map<number, string>();
			for (const token of sharedIpTokens) {
				if (token.ipAddress && !userIpMap.has(token.userId)) {
					userIpMap.set(token.userId, token.ipAddress);
				}
			}
			// Merge tracked IP users (tracked IPs take precedence as they're more comprehensive)
			for (const [linkedUserId, ip] of trackedIpUsersMap) {
				if (!userIpMap.has(linkedUserId)) {
					userIpMap.set(linkedUserId, ip);
				}
			}

			for (const [linkedUserId, ipAddress] of userIpMap) {
				if (!visited.has(linkedUserId)) {
					visited.add(linkedUserId);
					const connection: ForensicsConnection = {
						userId: linkedUserId,
						connectionType: 'ipAddress',
						connectionValue: ipAddress,
						path: currentPath // path shows intermediate users (empty = direct connection)
					};
					// Only add if not already found via device ID
					if (!linkedAccounts.has(linkedUserId)) {
						linkedAccounts.set(linkedUserId, connection);
					}
					queue.push({ userId: linkedUserId, path: [...currentPath, currentUserId] });
				}
			}
		}
	}

	// Filter out deleted and purged accounts
	const linkedUserIds = Array.from(linkedAccounts.keys());
	const existingAccounts = linkedUserIds.length > 0 
		? await Account.findAll({
			where: {
				id: { [Op.in]: linkedUserIds },
				purged: 0
			},
			attributes: ['id']
		})
		: [];
	
	const existingAccountIds = new Set(existingAccounts.map(acc => acc.id));
	const filteredLinkedAccounts = Array.from(linkedAccounts.values()).filter(
		conn => existingAccountIds.has(conn.userId)
	);

	const result: ForensicsResult = {
		userId,
		linkedAccounts: filteredLinkedAccounts
	};

	// Cache the result (no expiration - manual refresh only)
	await redis.set(rKey.userForensics(userId), JSON.stringify(result));

	logger.info(`Forensics analysis completed for user ${userId}. Found ${filteredLinkedAccounts.length} linked accounts (${linkedUserIds.length - filteredLinkedAccounts.length} deleted/purged accounts filtered out).`);
	return result;
}

export async function clearUserForensicsCache(userIdStr: string): Promise<void> {
	const userId = +userIdStr;
	await redis.del(rKey.userForensics(userId));
	logger.info(`Cleared forensics cache for user ${userId}`);
}

type ForensicsMetrics = {
	overview: {
		totalAccountsAnalyzed: number;
		accountsWithLinks: number;
		totalConnections: number;
		averageConnectionsPerAccount: number;
		accountsWithMultipleLinks: number;
	};
	topOffenders: {
		accountsWithMostLinks: Array<{ userId: number; username: string; linkedCount: number }>;
		ipsWithMostAccounts: Array<{ ip: string; accountCount: number; userIds: number[] }>;
		deviceIdsWithMostAccounts: Array<{ deviceId: string; accountCount: number; userIds: number[] }>;
	};
	suspiciousPatterns: {
		highConnectionAccounts: Array<{ userId: number; username: string; linkedCount: number; connectionTypes: { deviceId: number; ipAddress: number } }>;
		sharedIpClusters: Array<{ ip: string; accountCount: number; userIds: number[] }>;
		sharedDeviceClusters: Array<{ deviceId: string; accountCount: number; userIds: number[] }>;
	};
	connectionBreakdown: {
		deviceIdConnections: number;
		ipAddressConnections: number;
		totalConnections: number;
	};
};

export async function getForensicsMetrics(): Promise<ForensicsMetrics> {
	// Collect all forensics cache keys first
	const forensicsKeys: string[] = [];
	for await (const key of redis.scanIterator({ MATCH: 'ap:forensics:*', COUNT: 1000 })) {
		const match = (key as string).match(/^ap:forensics:(\d+)$/);
		if (match) {
			forensicsKeys.push(key as string);
		}
	}
	
	// Batch fetch all forensics data
	const forensicsData: Array<{ userId: number; linkedAccounts: ForensicsConnection[] }> = [];
	if (forensicsKeys.length > 0) {
		const cachedResults = await redis.mGet(forensicsKeys);
		cachedResults.forEach((cached, index) => {
			if (cached) {
				try {
					const data = JSON.parse(cached) as ForensicsResult;
					forensicsData.push(data);
				} catch (err) {
					logger.warn({ key: forensicsKeys[index], err }, 'Failed to parse forensics cache');
				}
			}
		});
	}

	// Collect all ipToUsers keys first
	const ipToUsersKeys: Array<{ key: string; ip: string }> = [];
	for await (const key of redis.scanIterator({ MATCH: 'ipToUsers:*', COUNT: 1000 })) {
		const match = (key as string).match(/^ipToUsers:(.+)$/);
		if (match) {
			ipToUsersKeys.push({ key: key as string, ip: match[1] });
		}
	}
	
	// Batch fetch all tracked IPs from Redis
	const [allLoginTokens, allTrackedIps] = await Promise.all([
		LoginToken.findAll({
			where: {
				[Op.or]: [
					{ xHqDeviceId: { [Op.ne]: null } },
					{ ipAddress: { [Op.ne]: null } }
				]
			},
			attributes: ['userId', 'xHqDeviceId', 'ipAddress']
		}),
		(async () => {
			const ipToUsersMap = new Map<string, Set<number>>();
			if (ipToUsersKeys.length > 0) {
				const sMembersResults = await Promise.all(
					ipToUsersKeys.map(({ key }) => redis.sMembers(key))
				);
				sMembersResults.forEach((userIds, index) => {
					if (userIds.length > 0) {
						ipToUsersMap.set(ipToUsersKeys[index].ip, new Set(userIds.map(id => +id)));
					}
				});
			}
			return ipToUsersMap;
		})()
	]);

	// Build comprehensive statistics
	const accountLinkCounts = new Map<number, number>();
	const ipAccountMap = new Map<string, Set<number>>();
	const deviceAccountMap = new Map<string, Set<number>>();
	const connectionTypeCounts = { deviceId: 0, ipAddress: 0 };

	// Process forensics data
	for (const data of forensicsData) {
		accountLinkCounts.set(data.userId, data.linkedAccounts.length);
		for (const conn of data.linkedAccounts) {
			if (conn.connectionType === 'deviceId') {
				connectionTypeCounts.deviceId++;
				if (!deviceAccountMap.has(conn.connectionValue)) {
					deviceAccountMap.set(conn.connectionValue, new Set());
				}
				deviceAccountMap.get(conn.connectionValue)!.add(conn.userId);
				deviceAccountMap.get(conn.connectionValue)!.add(data.userId);
			} else {
				connectionTypeCounts.ipAddress++;
				if (!ipAccountMap.has(conn.connectionValue)) {
					ipAccountMap.set(conn.connectionValue, new Set());
				}
				ipAccountMap.get(conn.connectionValue)!.add(conn.userId);
				ipAccountMap.get(conn.connectionValue)!.add(data.userId);
			}
		}
	}

	// Process LoginToken data for additional insights
	for (const token of allLoginTokens) {
		if (token.xHqDeviceId) {
			if (!deviceAccountMap.has(token.xHqDeviceId)) {
				deviceAccountMap.set(token.xHqDeviceId, new Set());
			}
			deviceAccountMap.get(token.xHqDeviceId)!.add(token.userId);
		}
		if (token.ipAddress) {
			if (!ipAccountMap.has(token.ipAddress)) {
				ipAccountMap.set(token.ipAddress, new Set());
			}
			ipAccountMap.get(token.ipAddress)!.add(token.userId);
		}
	}

	// Process tracked IPs
	for (const [ip, userIds] of allTrackedIps) {
		if (!ipAccountMap.has(ip)) {
			ipAccountMap.set(ip, new Set());
		}
		userIds.forEach(id => ipAccountMap.get(ip)!.add(id));
	}

	// Get account usernames for top offenders
	const allLinkedUserIds = new Set<number>();
	accountLinkCounts.forEach((count, userId) => {
		if (count > 0) allLinkedUserIds.add(userId);
	});
	ipAccountMap.forEach(userIds => userIds.forEach(id => allLinkedUserIds.add(id)));
	deviceAccountMap.forEach(userIds => userIds.forEach(id => allLinkedUserIds.add(id)));

	const accounts = await Account.findAll({
		where: { id: { [Op.in]: Array.from(allLinkedUserIds) } },
		attributes: ['id', 'name']
	});
	const accountMap = new Map(accounts.map(acc => [acc.id, acc]));

	// Calculate overview stats
	const totalAccountsAnalyzed = forensicsData.length;
	const accountsWithLinks = Array.from(accountLinkCounts.values()).filter(count => count > 0).length;
	const totalConnections = Array.from(accountLinkCounts.values()).reduce((sum, count) => sum + count, 0);
	const averageConnectionsPerAccount = totalAccountsAnalyzed > 0 ? totalConnections / totalAccountsAnalyzed : 0;
	const accountsWithMultipleLinks = Array.from(accountLinkCounts.values()).filter(count => count > 1).length;

	// Top offenders: Accounts with most linked accounts
	const topAccounts = Array.from(accountLinkCounts.entries())
		.map(([userId, count]) => ({
			userId,
			username: accountMap.get(userId)?.name ?? `User ${userId}`,
			linkedCount: count
		}))
		.filter(acc => acc.linkedCount > 0)
		.sort((a, b) => b.linkedCount - a.linkedCount)
		.slice(0, 50);

	// IPs with most accounts
	const topIps = Array.from(ipAccountMap.entries())
		.map(([ip, userIds]) => ({
			ip,
			accountCount: userIds.size,
			userIds: Array.from(userIds)
		}))
		.filter(item => item.accountCount > 1)
		.sort((a, b) => b.accountCount - a.accountCount)
		.slice(0, 50);

	// Device IDs with most accounts
	const topDevices = Array.from(deviceAccountMap.entries())
		.map(([deviceId, userIds]) => ({
			deviceId,
			accountCount: userIds.size,
			userIds: Array.from(userIds)
		}))
		.filter(item => item.accountCount > 1)
		.sort((a, b) => b.accountCount - a.accountCount)
		.slice(0, 50);

	// Suspicious patterns: Accounts with 5+ linked accounts
	const highConnectionAccounts = Array.from(accountLinkCounts.entries())
		.filter(([_, count]) => count >= 5)
		.map(([userId, linkedCount]) => {
			const account = accountMap.get(userId);
			if (!account) return null;
			
			// Count connection types for this account
			const forensics = forensicsData.find(d => d.userId === userId);
			const connectionTypes = { deviceId: 0, ipAddress: 0 };
			if (forensics) {
				forensics.linkedAccounts.forEach(conn => {
					connectionTypes[conn.connectionType]++;
				});
			}
			
			return {
				userId,
				username: account.name,
				linkedCount,
				connectionTypes
			};
		})
		.filter((acc): acc is NonNullable<typeof acc> => acc !== null)
		.sort((a, b) => b.linkedCount - a.linkedCount);

	// Shared IP clusters (3+ accounts)
	const sharedIpClusters = topIps.filter(item => item.accountCount >= 3);

	// Shared device clusters (3+ accounts)
	const sharedDeviceClusters = topDevices.filter(item => item.accountCount >= 3);

	return {
		overview: {
			totalAccountsAnalyzed,
			accountsWithLinks,
			totalConnections,
			averageConnectionsPerAccount: Math.round(averageConnectionsPerAccount * 100) / 100,
			accountsWithMultipleLinks
		},
		topOffenders: {
			accountsWithMostLinks: topAccounts,
			ipsWithMostAccounts: topIps,
			deviceIdsWithMostAccounts: topDevices
		},
		suspiciousPatterns: {
			highConnectionAccounts,
			sharedIpClusters,
			sharedDeviceClusters
		},
		connectionBreakdown: {
			deviceIdConnections: connectionTypeCounts.deviceId,
			ipAddressConnections: connectionTypeCounts.ipAddress,
			totalConnections: connectionTypeCounts.deviceId + connectionTypeCounts.ipAddress
		}
	};
}

/**
 * Runs forensics analysis on all users in the database.
 * Processes users in batches to avoid overwhelming the system.
 * 
 * @param batchSize Number of users to process in parallel (default: 10)
 * @param onProgress Optional callback for progress updates
 * @returns Summary of the operation
 */
export async function runForensicsOnAllUsers(
	batchSize: number = 10,
	onProgress?: (processed: number, total: number, errors: number) => void
): Promise<{ processed: number; total: number; errors: number; skipped: number }> {
	logger.info('Starting forensics analysis on all users...');

	// Get all user IDs from the database (excluding purged users)
	const allUsers = await Account.findAll({
		where: { purged: 0 },
		attributes: ['id'],
		order: [['id', 'ASC']]
	});

	const totalUsers = allUsers.length;
	const userIds = allUsers.map(u => u.id);
	
	logger.info(`Found ${totalUsers} users to analyze. Processing in batches of ${batchSize}...`);

	let processed = 0;
	let errors = 0;
	let skipped = 0;

	// Process users in batches
	for (let i = 0; i < userIds.length; i += batchSize) {
		const batch = userIds.slice(i, i + batchSize);
		
		// Process batch in parallel
		await Promise.allSettled(
			batch.map(async (userId) => {
				try {
					// Run forensics with force refresh to ensure fresh data
					await getUserForensics(String(userId), true);
					processed++;
				} catch (err) {
					// Check if it's a "user not found" error (deleted account)
					if (err instanceof HqError && err.statusCode() === 404) {
						skipped++;
						logger.debug({ userId }, 'Skipping deleted user in forensics analysis');
					} else {
						errors++;
						logger.warn({ userId, err }, 'Failed to run forensics on user');
					}
				}
			})
		);

		// Report progress
		const currentProcessed = processed + errors + skipped;
		if (onProgress) {
			onProgress(currentProcessed, totalUsers, errors);
		}
		
		// Log progress every 100 users
		if (currentProcessed % 100 === 0 || currentProcessed === totalUsers) {
			logger.info(`Forensics progress: ${currentProcessed}/${totalUsers} users processed (${processed} successful, ${errors} errors, ${skipped} skipped)`);
		}

		// Small delay between batches to avoid overwhelming the database
		if (i + batchSize < userIds.length) {
			await new Promise(resolve => setTimeout(resolve, 100));
		}
	}

	logger.info(`Forensics analysis completed: ${processed} successful, ${errors} errors, ${skipped} skipped out of ${totalUsers} total users`);

	return {
		processed,
		total: totalUsers,
		errors,
		skipped
	};
}

export async function getUsersBasic() {
	// Get all user IDs from Redis cache
	// We'll scan Redis for user keys, but a more efficient approach would be to get from DB
	// For now, we'll get from Redis cache which should have most active users
	
	// Scan Redis for user keys
	const userIds: number[] = [];
	for await (const key of redis.scanIterator({ MATCH: 'user:*', COUNT: 1000 })) {
		const match = (key as string).match(/^user:(\d+)$/);
		if (match) {
			const userId = +match[1];
			if (!isNaN(userId)) {
				userIds.push(userId);
			}
		}
	}
	
	// Get user data from Redis
	const users = await Promise.all(
		userIds.map(async (userId) => {
			const userData = await redis.hmGet(
				rKey.user(userId),
				['name', 'avatarUrl', 'purged']
			);
			
			const [name, avatarUrl, purged] = userData;
			
			// Skip purged users
			if (purged === '1') {
				return null;
			}
			
			return {
				id: userId,
				username: name || null,
				avatar: avatarUrl || null
			};
		})
	);
	
	return users.filter((user): user is NonNullable<typeof user> => user !== null);
}

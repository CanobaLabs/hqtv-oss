import { Upload } from '@aws-sdk/lib-storage';
import bcrypt from 'bcryptjs';
import { Op } from 'sequelize';
import sharp from 'sharp';
import Audit from '../../common/database/adminModels/audit';
import Account from '../../common/database/userModels/account';
import FriendRequest from '../../common/database/userModels/friendRequest';
import Keychain from '../../common/database/userModels/keychain';
import Referral from '../../common/database/userModels/referral';
import HqError from '../../common/hqError';
import HqId from '../../common/hqId';
import logger from '../../common/logger';
import redis from '../../common/redisClient';
import s3 from '../../common/s3';
import { getUser } from '../../common/utils/userGetters';
import defaultAvatars from '../defaultAvatars';
import addReferral from '../utils/addReferral';
import getProfilePartialWithCreated from '../utils/profileGetters/getProfilePartialWithCreated';
import * as users from './users';
import rKey from '../../common/redisKeys';
import { ChatBanLevel, GameBanLevel } from '../../common/enums';
import { publishUserEvent } from '../../common/utils/userEventPubSub';

export async function changeUsername(toUserId: number, proposedUsername: unknown, from: { userId: number; } | { employeeId: string; }) {
	const currentUser = await getUser(+toUserId);
    if (currentUser.purged) throw new HqError('user is purged', 400, 400);
	// change username
	logger.info(`Request name change. UID=${toUserId}, ProposedName=${proposedUsername}`);
	await users.verifyUsername(proposedUsername, 400);
    await Account.update(
        { name: proposedUsername },
        { where: { id: toUserId }, limit: 1 }
    );
    await Audit.create({
        to: toUserId,
        toType: 'account',
        from: 'userId' in from ? from.userId.toString() : from.employeeId,
        fromType: 'userId' in from ? 'account' : 'employee',
        action: 'set_username',
        description: 'Changed username from `' + currentUser.actualName + '` to `' + proposedUsername + '`'
    });
    return {};
}

export async function addReferralMiddle(userId: number, referringUsername: string) {
	const referral = await Referral.findOne({ where: { newUserId: userId } });
	const isReferralUnused = referral === null; // one referral per user
	if (isReferralUnused) {
		const referralUser = await users.verifyReferral(referringUsername, 400);
		const isReferringSelf = referralUser.id === userId;
		if (!isReferringSelf) {
			await addReferral(userId, referralUser.id);
		}
	}
}

export async function uploadAvatar(targetUser: { id: number; purged: boolean; currentAvatarUrl: string | null; }, requestingUserId: number, file?: Express.Multer.File, ) {
	// avatar uploading
    if (targetUser.purged) throw new HqError('user is purged', 400, 400);
    if (!file) {
        logger.info(`Avatar upload fail - no file attached. UID=${targetUser.id}`);
        throw new HqError('No media file was attached.', 490, 400);
    }
    if (!/jpeg/.test(file.mimetype)) {
        logger.info(`Avatar upload fail - invalid mimetype. UID=${targetUser.id}`);
        throw new HqError('The media\'s mimetype is not supported.', 492, 400);
    }
    const compressed = await sharp(file.buffer).resize({ height: 512, width: 512 }).jpeg({ quality: 20 }).toBuffer();
    if (compressed.length > 100000) {
        // 0.1mb
        logger.info(`Avatar upload fail - file too large. UID=${targetUser.id}`);
        throw new HqError('The media file size is too big.', 503, 400);
    }
    
    const avatarId = new HqId().avatar();
    await new Upload({
        client: s3,
        params: {
            Bucket: process.env.S3_BUCKET ?? "anolet",
            Key: `hqtv/a/${avatarId}.jpg`,
            Body: compressed
        }
    }).done();
    logger.info(`Avatar upload success. UID=${targetUser.id}, NewAvatarID=${avatarId}, OldAvatarURL=${targetUser.currentAvatarUrl}`);

    await Account.update({ avatarUrl: `${process.env.CDN_URL}/hqtv/a/${avatarId}.jpg` }, { where: { id: targetUser.id } });
    await Audit.create({
        to: targetUser.id,
        toType: 'account',
        from: requestingUserId,
        fromType: 'account',
        action: 'set_avatar',
        description: 'Changed avatar'
    });
    const updatedUser = await getUser(targetUser.id, true);
    const profile = getProfilePartialWithCreated(updatedUser);
    return profile;
}

export async function deleteAvatar(targetUser: { id: number; currentAvatarUrl: string | null; }) {
	// go back to a default avatar
    let newAvatarUrl: string | null = null;
    const currentAvatarIndex = defaultAvatars.indexOf(targetUser.currentAvatarUrl ?? '');
    if (currentAvatarIndex === -1) {
        // from a custom avatar
        newAvatarUrl = defaultAvatars[Math.floor(Math.random() * defaultAvatars.length)];
    } else if (currentAvatarIndex === defaultAvatars.length - 1) {
        // currently using default avatar
        // final avatar index; start from beginning
        [newAvatarUrl] = defaultAvatars;
    } else {
        // next avatar
        newAvatarUrl = defaultAvatars[currentAvatarIndex + 1];
    }

    await Account.update({ avatarUrl: newAvatarUrl }, { where: { id: targetUser.id } });
    logger.info(`Avatar delete. UID=${targetUser.id}, OldAvatarURL=${targetUser.currentAvatarUrl}`);
    
    const updatedUser = await getUser(targetUser.id, true);
    const profile = getProfilePartialWithCreated(updatedUser);
    return profile;
}

export async function purgeUser(userIdStr: string = '0', actioningEmployeeId: string = '?') {
	// get user
    const user = await getUser(+userIdStr);

	await deleteAvatar({ id: user.id, currentAvatarUrl: user.avatarUrl });
    const newUsername = "purged" + Math.floor(new Date().getTime() / 1000);
    await Account.update({ name: newUsername, purged: true }, { where: { id: userIdStr }, limit: 1 });
	await getUser(+userIdStr, true); // refresh user

	// remove any open friend requests the purged user is associated in
    await FriendRequest.destroy({
        where: { [Op.or]: [
            { senderId: userIdStr },
            { targetId: userIdStr }
        ]}
    });
    
    await Audit.create({
        to: userIdStr,
        toType: 'account',
        from: actioningEmployeeId,
        fromType: 'employee',
        action: 'purge_user',
        description: 'Purged user'
    });
    return { success: true };
}

export async function setUserPermission(ofUserId: string, setAdmin: unknown, setTester: unknown, setBooster: unknown, employeeId: string) {
	function normalizeFlag(flag: unknown, field: string): boolean | undefined {
		if (flag === undefined) return undefined;
		if (typeof flag === 'boolean') return flag;
		throw new HqError(`Invalid ${field} value`, 0, 400);
	}

	const adminFlag = normalizeFlag(setAdmin, 'admin');
	const testerFlag = normalizeFlag(setTester, 'tester');
	const boosterFlag = normalizeFlag(setBooster, 'booster');

	if (adminFlag === undefined && testerFlag === undefined && boosterFlag === undefined) {
		throw new HqError('No permission changes provided', 0, 400);
	}

    // get user
    const user = await Account.findOne({ where: { id: ofUserId } });
    if (!user) {
        throw new HqError('User not found.', 101, 404);
    }

	const updates: Partial<{ tester: boolean; admin: boolean; booster: boolean; }> = {};
	if (adminFlag !== undefined) updates.admin = adminFlag;
	if (testerFlag !== undefined) updates.tester = testerFlag;
	if (boosterFlag !== undefined) updates.booster = boosterFlag;

	if (Object.keys(updates).length === 0) {
		return { success: true };
	}

    await Account.update(updates, { where: { id: ofUserId }, limit: 1 });
    await redis.del(rKey.user(+ofUserId)); // didn't feel like writing logic to only update the modified values

    const auditMessages: string[] = [];
    if (adminFlag !== undefined && Number(adminFlag) !== Number(user.admin)) {
        auditMessages.push(adminFlag ? 'Granted admin status' : 'Revoked admin status');
    }
    if (testerFlag !== undefined && Number(testerFlag) !== Number(user.tester)) {
        auditMessages.push((testerFlag ? 'Granted' : 'Revoked') + ' tester status');
    }
    if (boosterFlag !== undefined && Number(boosterFlag) !== Number(user.booster)) {
        auditMessages.push((boosterFlag ? 'Granted' : 'Revoked') + ' booster status');
    }

    await Audit.create({
        to: ofUserId,
        toType: 'account',
        from: employeeId,
        fromType: 'employee',
        action: 'set_permissions',
        description: auditMessages.join(' and ') || 'No permission changes'
    });
    return { success: true };
}

export async function setPin(userId: number, newPin: string) {
	// pin setting
	let result: { name: string, iconUrl: string };
	if (!isNaN(+newPin) && newPin.length === 4) {
		const pinHash = await bcrypt.hash(newPin, 10);
		const [success] = await Keychain.update({ pinHash }, { where: { userId: userId }, limit: 1 });
		if (success) {
			logger.info(`PIN set success. UID=${userId}`);
			Audit.create({
				to: userId.toString(),
				toType: 'account',
				from: userId.toString(),
				fromType: 'account',
				action: 'set_pin',
				description: 'Changed PIN',
			});
			result = {
				name: `New sign-in code: *${newPin}*`,
				iconUrl: 'https://upload.wikimedia.org/wikipedia/commons/4/4c/Green-check-mark.png'
			};
		} else {
			logger.info(`PIN set fail. UID=${userId}`);
			result = {
				name: 'PIN set failed. Try again',
				iconUrl: 'https://upload.wikimedia.org/wikipedia/commons/5/5f/Red_X.png'
			};
		}
	} else {
		result = {
			name: 'PIN must be 4-digits',
			iconUrl: 'https://upload.wikimedia.org/wikipedia/commons/5/5f/Red_X.png'
		};
	}
	return [{
		userId: 0,
		username: result.name,
		avatarUrl: result.iconUrl,
		live: false,
		subscriberCount: 0,
		lastLive: null,
		featured: false,
		created: new Date()
	}];
}

export async function setUserChatBan(ofUserId: string, level: unknown, employeeId: string) {
	function normalizeChatBanLevel(level: unknown): ChatBanLevel {
		if (level === undefined || level === null) {
			throw new HqError('Chat ban level is required', 0, 400);
		}
		if (typeof level === 'number') {
			if (level === ChatBanLevel.NotBanned || level === ChatBanLevel.BannedNotify || level === ChatBanLevel.ShadowBan) {
				return level;
			}
		}
		if (typeof level === 'string') {
			const parsed = parseInt(level, 10);
			if (!isNaN(parsed) && (parsed === ChatBanLevel.NotBanned || parsed === ChatBanLevel.BannedNotify || parsed === ChatBanLevel.ShadowBan)) {
				return parsed;
			}
		}
		throw new HqError('Invalid chat ban level. Must be 0 (NotBanned), 1 (BannedNotify), or 2 (ShadowBan)', 0, 400);
	}

	const banLevel = normalizeChatBanLevel(level);

	// get user
	const user = await Account.findOne({ where: { id: ofUserId } });
	if (!user) {
		throw new HqError('User not found.', 101, 404);
	}

	// Check if the ban level is actually changing
	if (Number(banLevel) === Number(user.chatBan)) {
		return { success: true };
	}

	const banLevelNames: { [key: number]: string } = {
		[ChatBanLevel.NotBanned]: 'Not Banned',
		[ChatBanLevel.BannedNotify]: 'Banned (Notify)',
		[ChatBanLevel.ShadowBan]: 'Shadow Banned'
	};

	const oldLevelName = banLevelNames[Number(user.chatBan)] || `Level ${user.chatBan}`;
	const newLevelName = banLevelNames[banLevel] || `Level ${banLevel}`;

	await Account.update({ chatBan: banLevel }, { where: { id: ofUserId }, limit: 1 });
	
	// Update the cache instead of clearing it to avoid connection issues
	// This ensures the ban takes effect immediately without disrupting active connections
	// Check if cache exists by checking for a specific field (more efficient than getting all keys)
	const cacheExists = await redis.hExists(rKey.user(+ofUserId), 'name');
	if (cacheExists) {
		await redis.hSet(rKey.user(+ofUserId), 'chatBan', banLevel.toString());
	}
	// If not cached, no need to do anything - user will be fetched fresh on next access

	await Audit.create({
		to: ofUserId,
		toType: 'account',
		from: employeeId,
		fromType: 'employee',
		action: 'set_chat_ban',
		description: `Changed chat ban from ${oldLevelName} to ${newLevelName}`
	});

	// Notify producers of ban status change
	await publishUserEvent('banStatusUpdate', +ofUserId);

	return { success: true };
}

export async function setUserGameBan(ofUserId: string, level: unknown, employeeId: string) {
	function normalizeGameBanLevel(level: unknown): GameBanLevel {
		if (level === undefined || level === null) {
			throw new HqError('Game ban level is required', 0, 400);
		}
		if (typeof level === 'number') {
			if (level === GameBanLevel.NotBanned || level === GameBanLevel.AntiWin || level === GameBanLevel.JoinBan) {
				return level;
			}
		}
		if (typeof level === 'string') {
			const parsed = parseInt(level, 10);
			if (!isNaN(parsed) && (parsed === GameBanLevel.NotBanned || parsed === GameBanLevel.AntiWin || parsed === GameBanLevel.JoinBan)) {
				return parsed;
			}
		}
		throw new HqError('Invalid game ban level. Must be 0 (NotBanned), 1 (AntiWin), or 2 (JoinBan)', 0, 400);
	}

	const banLevel = normalizeGameBanLevel(level);

	// get user
	const user = await Account.findOne({ where: { id: ofUserId } });
	if (!user) {
		throw new HqError('User not found.', 101, 404);
	}

	// Check if the ban level is actually changing
	if (Number(banLevel) === Number(user.gameBan)) {
		return { success: true };
	}

	const banLevelNames: { [key: number]: string } = {
		[GameBanLevel.NotBanned]: 'Not Banned',
		[GameBanLevel.AntiWin]: 'Anti-Win',
		[GameBanLevel.JoinBan]: 'Join Ban'
	};

	const oldLevelName = banLevelNames[Number(user.gameBan)] || `Level ${user.gameBan}`;
	const newLevelName = banLevelNames[banLevel] || `Level ${banLevel}`;

	await Account.update({ gameBan: banLevel }, { where: { id: ofUserId }, limit: 1 });
	await redis.del(rKey.user(+ofUserId)); // clear cache

	await Audit.create({
		to: ofUserId,
		toType: 'account',
		from: employeeId,
		fromType: 'employee',
		action: 'set_game_ban',
		description: `Changed game ban from ${oldLevelName} to ${newLevelName}`
	});

	// If user is being join-banned, publish event to immediately kick them from all games
	if (banLevel === GameBanLevel.JoinBan) {
		await publishUserEvent('kickUser', +ofUserId);
	}
	// If user is being unbanned (was join-banned, now not banned), remove them from kicked sets
	else if (Number(user.gameBan) === GameBanLevel.JoinBan && banLevel === GameBanLevel.NotBanned) {
		await publishUserEvent('unbanUser', +ofUserId);
	}

	// Notify producers of ban status change
	await publishUserEvent('banStatusUpdate', +ofUserId);

	return { success: true };
}

export async function setUserAppBan(ofUserId: string, banned: unknown, employeeId: string) {
	function normalizeFlag(flag: unknown): boolean {
		if (flag === undefined || flag === null) {
			throw new HqError('App ban status is required', 0, 400);
		}
		if (typeof flag === 'boolean') return flag;
		if (typeof flag === 'string') {
			if (flag === 'true' || flag === '1') return true;
			if (flag === 'false' || flag === '0') return false;
		}
		if (typeof flag === 'number') {
			return flag !== 0;
		}
		throw new HqError('Invalid app ban value. Must be a boolean or 0/1', 0, 400);
	}

	const banFlag = normalizeFlag(banned);

	// get user
	const user = await Account.findOne({ where: { id: ofUserId } });
	if (!user) {
		throw new HqError('User not found.', 101, 404);
	}

	const banValue = banFlag ? 1 : 0;

	// Check if the ban status is actually changing
	if (Number(banValue) === Number(user.appBan)) {
		return { success: true };
	}

	await Account.update({ appBan: banValue }, { where: { id: ofUserId }, limit: 1 });
	await redis.del(rKey.user(+ofUserId)); // clear cache

	const description = banFlag ? 'Applied app ban' : 'Removed app ban';

	await Audit.create({
		to: ofUserId,
		toType: 'account',
		from: employeeId,
		fromType: 'employee',
		action: 'set_app_ban',
		description: description
	});

	// If user is being banned, publish event to disconnect them from all socket connections
	if (banFlag) {
		await publishUserEvent('disconnectUser', +ofUserId, 'You have been removed from the game for a violation of HQTV\'s Terms of Service and Contest Rules.');
	}
	// If user is being unbanned, remove them from kicked sets so they can rejoin
	else if (Number(user.appBan) === 1) {
		await publishUserEvent('unbanUser', +ofUserId);
	}

	// Notify producers of ban status change
	await publishUserEvent('banStatusUpdate', +ofUserId);

	return { success: true };
}

export async function resetUserPin(ofUserId: string, employeeId: string) {
	// get user
	const user = await Account.findOne({ where: { id: ofUserId } });
	if (!user) {
		throw new HqError('User not found.', 101, 404);
	}

	// Check if user has a keychain entry
	const keychain = await Keychain.findOne({ where: { userId: ofUserId } });
	if (!keychain) {
		// User doesn't have a keychain entry, so no pin to reset
		return { success: true };
	}

	// Check if pin already doesn't exist
	if (!keychain.pinHash || keychain.pinHash.trim() === '') {
		return { success: true };
	}

	// Remove pin by setting pinHash to null
	await Keychain.update({ pinHash: null }, { where: { userId: ofUserId }, limit: 1 });

	await Audit.create({
		to: ofUserId,
		toType: 'account',
		from: employeeId,
		fromType: 'employee',
		action: 'reset_pin',
		description: 'Reset PIN'
	});

	return { success: true };
}

export async function changeUserPhoneNumber(ofUserId: string, newPhone: unknown, employeeId: string) {
	// Validate phone number
	if (newPhone === undefined || newPhone === null) {
		throw new HqError('Phone number is required', 0, 400);
	}

	const phone = String(newPhone).replace(/[^+0-9]/g, ''); // only numbers & plus symbol
	if (!phone || phone.trim() === '') {
		throw new HqError('Invalid phone number', 0, 400);
	}

	// get user
	const user = await Account.findOne({ where: { id: ofUserId } });
	if (!user) {
		throw new HqError('User not found.', 101, 404);
	}

	// Check if user has a keychain entry
	const keychain = await Keychain.findOne({ where: { userId: ofUserId } });
	const oldPhone = keychain?.phone ?? null;
	
	if (!keychain) {
		// Create new keychain entry
		await Keychain.create({ phone: phone, userId: +ofUserId });
		await Audit.create({
			to: ofUserId,
			toType: 'account',
			from: employeeId,
			fromType: 'employee',
			action: 'change_phone',
			description: `Set phone number to ${phone}`
		});
	} else {
		// Update phone number
		await Keychain.update({ phone: phone }, { where: { userId: ofUserId }, limit: 1 });
		await Audit.create({
			to: ofUserId,
			toType: 'account',
			from: employeeId,
			fromType: 'employee',
			action: 'change_phone',
			description: `Changed phone number from ${oldPhone ?? 'none'} to ${phone}`
		});
	}

	return { success: true };
}

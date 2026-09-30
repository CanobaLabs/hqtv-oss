import express from 'express';
import multer from 'multer';
import HqError from '../../common/hqError';
import { getUser } from '../../common/utils/userGetters';
import authorise from '../middleware/authorise';
import cfAuth from '../middleware/cfAuth';
import collectRequestMeta from '../middleware/collectRequestMeta';
import rateLimiter from '../middleware/requestRateLimiter';
import { restrictToAdmin, restrictToSelfOrAdmin, restrictToTesterOrAdmin } from '../middleware/restrictToPrivilege';
import verifyOffairGameOwnership from '../middleware/verifyOffairGameOwnership';
import * as broadcasts from '../routeHandlers/broadcast';
import * as configGetters from '../routeHandlers/configGetters';
import * as friends from '../routeHandlers/friends';
import * as offairTrivia from '../routeHandlers/offairTrivia';
import * as schedule from '../routeHandlers/schedule';
import * as seasonXp from '../routeHandlers/seasonXp';
import * as store from '../routeHandlers/store';
import * as telemetry from '../routeHandlers/telemetry';
import * as userUpdaters from '../routeHandlers/userUpdaters';
import * as users from '../routeHandlers/users';
import * as verifications from '../routeHandlers/verifications';
import * as wins from '../routeHandlers/wins';
import generateCalendar from '../utils/generateCalendar';
import paginateData from '../utils/paginateData';
import getProfilePartialWithCreated from '../utils/profileGetters/getProfilePartialWithCreated';
import catchErrors from '../middleware/catchErrors';
import getLeaderboard from '../utils/getLeaderboard';
import { LbMode } from '../../common/enums';

const api = express.Router();

api.get('/', catchErrors(async function (req, res, next) {
	res.json({
		authentication: '/authenticate',
		registration: '/users'
	});
}));

api.get('/config', authorise(), collectRequestMeta, catchErrors(async function (req, res, next) {
	const result = await configGetters.getMainConfig();
	return res.json(result);
}));

api.get('/config/public', catchErrors(async function (req, res, next) {
	const result = await configGetters.getPublicConfig();
	return res.json(result);
}));

api.get('/config/admin', authorise(), catchErrors(async function (req, res, next) {
	const result = await configGetters.getAdminConfig(req.authUser.admin, req.authUser.tester);
	return res.json(result);
}));

api.post('/verifications/verify-existing-phone', catchErrors(async function (req, res, next) {
	const result = await verifications.getOrCreatePhoneVerification(req.body.phone);
	return res.json(result);
}));

api.post('/verifications/:verificationId', rateLimiter, catchErrors(async function (req, res, next) {
	// rate limited for security
	const result = await verifications.checkVerificationCode(req.params.verificationId, req.body.code, req.headers);
	return res.json(result);
}));

api.post('/usernames/available', catchErrors(async function (req, res, next) {
	await users.verifyUsername(req.body.username);
	return res.json({});
}));

api.post('/referral-code/valid', catchErrors(async function (req, res, next) {
	await users.verifyReferral(req.body.referralCode);
	return res.json({});
}));

api.post('/tokens', catchErrors(async function (req, res, next) {
	const result = await users.getAuthFromLoginToken(req.body.token, req.headers);
	return res.json(result);
}));

api.get('/opt-in', catchErrors(async function (req, res, next) {
	const result = await schedule.getOpts();
	return res.json(result);
}));

api.get('/shows/schedule', authorise(), catchErrors(async function (req, res, next) {
	const publicAccess = await schedule.isSchedulePublic(req.query.type as string);
	if (publicAccess) {
		return next();
	} else {
		return restrictToTesterOrAdmin(req, res, next);
	}
}), catchErrors(async function (req, res, next) {
	const isIOS = req.headers['x-hq-client']?.includes('iOS') ?? false;
	const result = await schedule.getScheduleForType(req.authUser.id, req.authUser.admin, req.authUser.tester, req.query.type as string, isIOS, req);
	return res.json(result);
}));

api.get('/broadcasts/:broadcastId(\\d+)/viewers', cfAuth(), authorise(), catchErrors(async function (req, res, next) {
	const result = await broadcasts.getViewers(req.params.broadcastId as string, req.query.mode as string, req.offset, req.query.superSecretLimitOverride as string);
	const paginated = paginateData(req, result);
	return res.json(paginated);
}));

api.get('/broadcasts/:broadcastId(\\d+)/viewers/friends', authorise(), catchErrors(async function (req, res, next) {
	const result = await broadcasts.getViewersWhoAreFriendsOfUser(req.authUser.id, req.params.broadcastId as string);
	return res.json(result);
}));

api.delete('/shows/broadcasts/:broadcastId(\\d+)/players/:userId(\\d+)', authorise(), restrictToAdmin, catchErrors(async function (req, res, next) {
	// to be moved to websocket api**
	const result = await broadcasts.kickPlayerFromGame(req.params.broadcastId, req.params.userId, req.authUser.id);
	return res.json(result);
}));

api.get('/store/products', authorise(), catchErrors(async function (req, res, next) {
	const result = await store.getStoreProducts();
	return res.json(result);
}));

api.post('/store/:sku/purchase', authorise(), catchErrors(async function (req, res, next) {
	const result = await store.purchaseItem(req.authUser.id, req.params.sku);
	return res.json(result);
}));

api.get('/seasonXp/settings', authorise(), catchErrors(async function (req, res, next) {
	const result = await seasonXp.getSeasonSettings();
	return res.json(result);
}));

api.get('/seasonXp/levels', authorise(), catchErrors(async function (req, res, next) {
	const result = await seasonXp.getSeasonLevels(req.authUser.seasonXp);
	return res.json(result);
}));

api.post('/offair-trivia/start-game', authorise(), catchErrors(async function (req, res, next) {
	const result = await offairTrivia.startGame(req.authUser.id);
	return res.json(result);
}));

api.get('/offair-trivia/:gameUuid', authorise(), verifyOffairGameOwnership, catchErrors(async function (req, res, next) {
	const result = await offairTrivia.question(req.authUser.erasers, req.params.gameUuid);
	return res.json(result);
}));

api.post('/offair-trivia/:gameUuid/answers', authorise(), verifyOffairGameOwnership, catchErrors(async function (req, res, next) {
	const result = await offairTrivia.submitAnswer(req.authUser, req.params.gameUuid, req.body.offairAnswerId);
	return res.json(result);
}));

api.post('/easter-eggs/makeItRain', authorise(), catchErrors(async function (req, res, next) {
	// life trick
	const claimSuccess = await users.tryToClaimMakeItRain(req.authUser);
	if (claimSuccess) {
		return next();
	} else {
		return restrictToAdmin(req, res, next); // unlim for admins
	}
}), catchErrors(async function (req, res, next) {
	const result = await users.makeItRainSuccess(req.authUser);
	return res.json(result);
}));

api.post('/telemetry/logs', authorise(false), catchErrors(async function (req, res, next) {
	const result = await telemetry.logTelemetryEvent(req.body, req.authUser.id);
	return res.json(result);
}));

api.route('/users')
	.get(authorise(), catchErrors(async function (req, res, next) {
		// user search
		const q = req.query.q as string;
		let results = [];
		if (q.startsWith('/pin ')) {
			const newPin = q.split(' ')[1];
			results = await userUpdaters.setPin(req.authUser.id, newPin);
		} else {
			results = await users.searchUser(req.query.q as string, req.offset);
		}
		const paginated = paginateData(req, results);
		return res.json(paginated);
	}))
	.post(catchErrors(async function (req, res, next) {
		// sign in/create account
		const result = await verifications.createAccountOrSignIn(req.body.verificationId, req.body.username, req.headers);
		return res.json(result);
	}));

api.route('/users/:userId(\\d+|me)')
	.get(authorise(), catchErrors(async function (req, res, next) {
		// profile
		const result = await users.getProfile(req.reqUser, req.authUser, req.params.userId);
		return res.json(result);
	}))
	.patch(authorise(), restrictToSelfOrAdmin, catchErrors(async function (req, res, next) {
		// change username/add referral
		if (req.body.username) {
			await userUpdaters.changeUsername(req.reqUser.id, req.body.username, { userId: req.authUser.id });
		} else if (req.body.referringUsername) {
			await userUpdaters.addReferralMiddle(req.authUser.id, req.body.referringUsername);
		} else {
			throw new HqError('missing a required argument', 401, 400);
		}
		const updatedUser = await getUser(req.authUser.id, true); // get changes
		const profile = getProfilePartialWithCreated(updatedUser);
		return res.json(profile);
	}));

api.route('/users/:userId(\\d+|me)/payouts')
	.get(authorise(), restrictToSelfOrAdmin, catchErrors(async function (req, res, next) {
		// balance
		const result = await users.getBalance(req.reqUser.id);
		return res.json(result);
	}))
	.post(authorise(), restrictToSelfOrAdmin, catchErrors(async function (req, res, next) {
		// submit payout request
		const result = await wins.createPayout(req.authUser.id, req.body.type, req.body.email, req.headers);
		return res.json(result);
	}));

const upload = multer({
	storage: multer.memoryStorage()
});
api.post('/users/:userId(\\d+|me)/avatar', authorise(), restrictToSelfOrAdmin, upload.single('file'), catchErrors(async function (req, res, next) {
	// upload profile pic
	const result = await userUpdaters.uploadAvatar({ id: req.reqUser.id, purged: req.reqUser.purged, currentAvatarUrl: req.reqUser.avatarUrl }, req.authUser.id, req.file);
	return res.json(result);
}));

api.delete('/users/:userId(\\d+|me)/avatarUrl', authorise(), restrictToSelfOrAdmin, catchErrors(async function (req, res, next) {
	// delete profile pic
	const result = await userUpdaters.deleteAvatar({ id: req.reqUser.id, currentAvatarUrl: req.reqUser.avatarUrl });
	return res.json(result);
}));

api.get('/users/leaderboard', authorise(), catchErrors(async function (req, res, next) {
	const mode = req.query.mode;
	if (mode != LbMode.Week && mode != LbMode.Alltime) {
		throw new HqError('invalid argument', 402, 400);
	}
	const result = await getLeaderboard(mode as LbMode);
	return res.json({ data: result });
}));

api.post('/users/lives', authorise(), restrictToAdmin, catchErrors(async function (req, res, next) {
	// grant extra life (admin)
	const result = await users.grantExtraLife(req.body.userId, req.body.count, req.authUser.id);
	return res.json(result);
}));

api.get('/friends', authorise(), catchErrors(async function (req, res, next) {
	const { data, count } = await friends.getFriendProfiles(req.authUser.id, req.offset, req.authUser);
	const paginated = paginateData(req, data);
	return res.json({
		...paginated,
		count: count // total number of friends (not number of results)
	});
}));

api.route('/friends/:userId(\\d+)')
	.get(authorise(), catchErrors(async function (req, res, next) {
		// profile of friend
		const result = await friends.getProfileOfFriend(req.reqUser, req.authUser);
		return res.json(result);
	}))
	.delete(authorise(), catchErrors(async function (req, res, next) {
		// unfriend
		const result = await friends.removeFriend(req.reqUser.id, req.authUser.id);
		return res.json(result);
	}));

api.get('/friends/:userId(\\d+|me)/all', authorise(), restrictToSelfOrAdmin, catchErrors(async function (req, res, next) {
	const result = await friends.getAllFriendStatuses(req.reqUser.id);
	return res.json(result);
}));

api.route('/friends/:userId(\\d+)/status')
	.get(authorise(), catchErrors(async function (req, res, next) {
		// tells app if friends/not friends, etc
		const result = await friends.getFriendshipStatus(req.authUser.id, req.reqUser.id);
		return res.json(result);
	}))
	.put(authorise(), catchErrors(async function (req, res, next) {
		// recipient accepts/rejects
		const result = await friends.changeFriendRequestStatus(req.authUser.id, req.reqUser.id, req.body.status);
		return res.json(result);
	}));

api.route('/friends/:userId(\\d+)/requests')
	.post(authorise(), catchErrors(async function (req, res, next) {
		// send friend request
		const result = await friends.createFriendRequest(req.authUser.id, req.reqUser.id);
		console.log(result);
		return res.json(result);
	}))
	.delete(authorise(), catchErrors(async function (req, res, next) {
		// retract friend request
		const result = await friends.cancelOutboundFriendRequest(req.authUser.id, req.reqUser.id);
		return res.json(result);
	}));

api.get('/friends/requests/incoming', authorise(), catchErrors(async function (req, res, next) {
	const { data, count } = await friends.getIncomingFriendRequests(req.authUser.id, req.offset);
	const paginated = paginateData(req, data);
	return res.json({
		...paginated,
		count: count
	});
}));

api.get('/friends/requests/incoming/count', authorise(), catchErrors(async function (req, res, next) {
	const { count } = await friends.getIncomingFriendRequests(req.authUser.id);
	return res.json({ count: count });
}));

api.get('/calendar', catchErrors(async function (req, res, next) {
	// special route
	res.setHeader("Content-Type", "text/calendar; charset=UTF-8");
	const opts = req.query?.opts ? (req.query?.opts as string).split(",") : [];
	const result = await generateCalendar(opts);
	return res.send(result);
}));

api.get('/achievements/v2/me', catchErrors(async function (req, res, next) {
	res.json({
		earnedAchievementCount: 0,
		families: []
	});
}));

api.get('/wave/messages', catchErrors(async function (req, res, next) {
	res.json([]);
}));

api.post('/contacts', catchErrors(async function (req, res, next) {
	res.json({});
}));

api.get('/contacts/players', catchErrors(async function (req, res, next) {
	res.json({});
}));

api.get('/contacts/non-players', catchErrors(async function (req, res, next) {
	res.json({});
}));

api.post('/terms-agreement/0', catchErrors(async function (req, res, next) {
	res.json({});
}));

api.post('/users/me/devices', catchErrors(async function (req, res, next) {
	res.json({});
}));

export default api;

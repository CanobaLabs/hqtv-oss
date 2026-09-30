import bodyParser from 'body-parser';
import { validate } from 'express-validation';
import { getUser } from '../../common/utils/userGetters';
import createGiftDrop from '../../websocket/helpers/createGiftDrop';
import authorise from '../middleware/authorise';
import cfAuth from '../middleware/cfAuth';
import * as adminPanel from '../routeHandlers/adminPanel';
import * as broadcasts from '../routeHandlers/broadcast';
import * as devops from '../routeHandlers/devops';
import * as employees from '../routeHandlers/employees';
import * as friends from '../routeHandlers/friends';
import * as games from '../routeHandlers/games';
import * as offairTrivia from '../routeHandlers/offairTrivia';
import * as productions from '../routeHandlers/productions';
import * as schedule from '../routeHandlers/schedule';
import * as seasonXp from '../routeHandlers/seasonXp';
import * as season from '../routeHandlers/season';
import * as store from '../routeHandlers/store';
import * as userUpdaters from '../routeHandlers/userUpdaters';
import * as users from '../routeHandlers/users';
import * as wins from '../routeHandlers/wins';
import * as configs from '../routeHandlers/config';
import * as announcements from '../routeHandlers/announcements';
import getBalanceSummary from '../utils/getBalanceSummary';
import getProfileFullPrivate from '../utils/profileGetters/getProfileFullPrivate';
import express from 'express';
import { restrictToAdmin, restrictToGameEditorOrPermission, restrictToGameScheduleEditorOrPermission, restrictToGameHostOrProducer, restrictToGameHostOrProducerOrEditPermission } from '../middleware/restrictToPrivilege';
import catchErrors from '../middleware/catchErrors';
import permission from '../middleware/permission';
import paginateData from '../utils/paginateData';
import HqError from '../../common/hqError';
import logger from '../../common/logger';
import { LbMode } from '../../common/enums';
import getLeaderboard from '../utils/getLeaderboard';
import runGameCommand from '../../websocket/gameMasterHandlers/runGameCommand';
import Broadcast from '../../common/database/eventModels/broadcast';
import redis from '../../common/redisClient';
import rGameKey from '../../websocket/wsTypes/redisGameKeys';
import getGeneralConfig from '../utils/getGeneralConfig';

const api = express.Router();

const selfOrPermission = (perm: string) => {
	const permMiddleware = permission(perm);
	return (req: express.Request, res: express.Response, next: express.NextFunction) => {
		const cfAuth = req.cfAuth;
		if (cfAuth && req.params.userId && String(req.params.userId) === String(cfAuth.userId ?? cfAuth.id)) {
			return next();
		}
		return permMiddleware(req, res, next);
	};
};

api.post('/gifts/drops/new', authorise(), restrictToAdmin, catchErrors(async function (req, res, next) {
	const result = await createGiftDrop(req.authUser.id, false, req.body);
	return res.json(result);
}));

api.get('/ap/metrics', cfAuth(), permission('metrics.view'), catchErrors(async function (req, res, next) {
	const result = await adminPanel.getMetrics();
	return res.json(result);
}));

api.get('/ap/store/products', cfAuth(), permission('store.view'), catchErrors(async function (req, res, next) {
	const result = await store.getStoreProducts();
	return res.json(result);
}));

api.get('/ap/store/metrics', cfAuth(), permission('store.view'), catchErrors(async function (req, res, next) {
	const result = await store.getStoreMetrics();
	return res.json(result);
}));

api.get('/ap/store/purchases', cfAuth(), permission('store.view'), catchErrors(async function (req, res, next) {
	const limitParamRaw = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
	const beforeIdParamRaw = Array.isArray(req.query.beforeId) ? req.query.beforeId[0] : req.query.beforeId;
	const limit = limitParamRaw !== undefined ? Number(limitParamRaw) : undefined;
	const beforeId = beforeIdParamRaw !== undefined ? Number(beforeIdParamRaw) : undefined;
	const result = await store.getRecentStorePurchases({ limit, beforeId });
	return res.json({ data: result });
}));

api.put('/ap/store/products', cfAuth(), permission('store.edit'), catchErrors(async function (req, res, next) {
	const result = await store.replaceStoreProducts(req.body, req.cfAuth!.userId);
	return res.json(result);
}));

api.post('/ap/store/products/items', cfAuth(), permission('store.edit'), catchErrors(async function (req, res, next) {
	const result = await store.upsertStoreProductItem(req.body, req.cfAuth!.userId);
	return res.json(result);
}));

api.patch('/ap/store/products/items/:sku', cfAuth(), permission('store.edit'), catchErrors(async function (req, res, next) {
	const result = await store.upsertStoreProductItem({ ...req.body, sku: req.params.sku }, req.cfAuth!.userId);
	return res.json(result);
}));

api.delete('/ap/store/products/items/:sku', cfAuth(), permission('store.edit'), catchErrors(async function (req, res, next) {
	const result = await store.removeStoreProductItem(req.params.sku, req.cfAuth!.userId);
	return res.json(result);
}));

api.post('/ap/store/products/reset', cfAuth(), permission('store.edit'), catchErrors(async function (req, res, next) {
	const result = await store.resetStoreProductsToDefault(req.cfAuth!.userId);
	return res.json(result);
}));

api.get('/ap/leaderboard', cfAuth(), permission('wins.view'), catchErrors(async function (req, res, next) {
	const modeParamRaw = Array.isArray(req.query.mode) ? req.query.mode[0] : req.query.mode;
	const modeParam = modeParamRaw === undefined ? undefined : String(modeParamRaw).toLowerCase();

	let mode: LbMode;
	switch (modeParam) {
		case 'week':
		case '1':
			mode = LbMode.Week;
			break;
		case 'alltime':
		case '0':
			mode = LbMode.Alltime;
			break;
		default:
			throw new HqError('invalid argument', 402, 400);
	}

	const result = await getLeaderboard(mode);
	return res.json({ data: result });
}));

api.route('/ap/config/keepPlaying')
	.get(cfAuth(), permission('config.view'), catchErrors(async function (req, res, next) {
		const result = await configs.getKeepPlayingConfig();
		return res.json(result);
	}))
	.post(cfAuth(), permission('config.edit'), catchErrors(async function (req, res, next) {
		const result = await configs.setKeepPlayingConfig(req.cfAuth!.userId, req.body);
		return res.json(result);
	}));

api.route('/ap/config/offairTrivia')
	.get(cfAuth(), permission('config.view'), catchErrors(async function (req, res, next) {
		const result = await configs.getOffairTriviaConfig();
		return res.json(result);
	}))
	.post(cfAuth(), permission('config.edit'), catchErrors(async function (req, res, next) {
		const result = await configs.setOffairTriviaConfig(req.cfAuth!.userId, req.body);
		return res.json(result);
	}));

api.route('/ap/config/streak')
	.get(cfAuth(), permission('config.view'), catchErrors(async function (req, res, next) {
		const result = await configs.getStreakConfig();
		return res.json(result);
	}))
	.post(cfAuth(), permission('config.edit'), catchErrors(async function (req, res, next) {
		const result = await configs.setStreakConfig(req.cfAuth!.userId, req.body);
		return res.json(result);
	}));

api.route('/ap/config/general')
	.get(cfAuth(), permission('config.view'), catchErrors(async function (req, res, next) {
		const result = await configs.getGeneralConfig();
		return res.json(result);
	}))
	.post(cfAuth(), permission('config.edit'), catchErrors(async function (req, res, next) {
		const result = await configs.setGeneralConfig(req.cfAuth!.userId, req.body);
		return res.json(result);
	}));

api.route('/ap/config/main')
	.get(cfAuth(), permission('config.view'), catchErrors(async function (req, res, next) {
		const result = await configs.getMainConfig();
		return res.json(result);
	}))
	.put(cfAuth(), permission('config.edit'), catchErrors(async function (req, res, next) {
		const result = await configs.setMainConfig(req.cfAuth!.userId, req.body);
		return res.json(result);
	}));

api.route('/ap/config/public')
	.get(cfAuth(), permission('config.view'), catchErrors(async function (req, res, next) {
		const result = await configs.getPublicConfig();
		return res.json(result);
	}))
	.put(cfAuth(), permission('config.edit'), catchErrors(async function (req, res, next) {
		const result = await configs.setPublicConfig(req.cfAuth!.userId, req.body);
		return res.json(result);
	}));

api.get('/ap/config/liveConfig', cfAuth(), permission('game.view'), catchErrors(async function (req, res, next) {
	const result = await configs.getAllLiveConfigs();
	return res.json(result);
}));

api.get('/ap/games/latestGameId', cfAuth(), permission('schedule.view'), catchErrors(async (req, res, next) => {
	const result = await games.getLatestGameId();
	return res.json(result);
}));

api.get('/ap/games/search', cfAuth(), catchErrors(async (req, res, next) => {
	const searchTerm = req.query.q ?? req.query.search ?? req.query.term;
	if (!searchTerm || typeof searchTerm !== 'string') {
		throw new HqError('Search term is required', 0, 400);
	}
	const result = await games.searchGamesByContent(searchTerm, req.cfAuth!.userId);
	return res.json({ data: result });
}));

api.route('/ap/games/:id')
	.get(cfAuth(), permission('schedule.view'), catchErrors(async function (req, res, next) {
		const result = await games.getGame(req.params.id as string);
		return res.json(result);
	}))
	.post(cfAuth(), permission('games.create'), validate(require('../validation/game'), {}, {}), catchErrors(async function (req, res, next) {
		const result = await games.createGame(req.params.id as string, req.cfAuth!.userId, req.body);
		return res.json(result);
	}))
	.patch(cfAuth(), restrictToGameHostOrProducerOrEditPermission, catchErrors(async function (req, res, next) {
		const result = await games.updateGame(req.params.id as string, req.cfAuth!.id, req.body);
		return res.json(result);
	}))
	.delete(cfAuth(), restrictToGameHostOrProducerOrEditPermission, catchErrors(async function (req, res, next) {
		const result = await games.deleteGame(req.params.id as string, req.cfAuth!.id);
		return res.json(result);
	}));

api.route('/ap/games/:id/schedule')
	.get(cfAuth(), permission('schedule.view'), catchErrors(async function (req, res, next) {
		const result = await games.getScheduledGame(req.params.id as string);
		return res.json(result);
	}))
	.post(cfAuth(), restrictToGameScheduleEditorOrPermission, catchErrors(async function (req, res, next) {
		const result = await games.scheduleGame(req.params.id as string, req.cfAuth!.id, req.body);
		return res.json(result);
	}));

api.post('/ap/games/production/batch', cfAuth(), permission('schedule.view'), catchErrors(async function (req, res, next) {
	if (!req.body.gameIds || !Array.isArray(req.body.gameIds)) {
		throw new HqError('gameIds must be an array', 0, 400);
	}
	const result = await productions.getProductionForGamesBatch(req.body.gameIds);
	return res.json({ data: result });
}));

api.route('/ap/games/:id/production')
	.get(cfAuth(), permission('schedule.view'), catchErrors(async function (req, res, next) {
		const result = await productions.getProductionForGame(req.params.id as string);
		return res.json(result);
	}))
	.patch(cfAuth(), restrictToGameHostOrProducerOrEditPermission, catchErrors(async (req, res, next) => {
		const result = await productions.addEmployeesToProduction(req.params.id as string, req.cfAuth!.id, req.body);
		return res.json(result);
	}))
	.delete(cfAuth(), restrictToGameHostOrProducerOrEditPermission, catchErrors(async function (req, res, next) {
		const result = await productions.removeEmployeesFromProduction(req.params.id as string, req.cfAuth!.id, req.body);
		return res.json(result);
	}));

api.patch('/ap/games/:id/production/questions_status', cfAuth(), restrictToGameEditorOrPermission, catchErrors(async function (req, res, next) {
	const result = await productions.updateQuestionsStatus(req.params.id as string, req.body.status, req.cfAuth!.id);
	return res.json(result);
}));

api.patch('/ap/games/:id/production/script_status', cfAuth(), restrictToGameEditorOrPermission, catchErrors(async function (req, res, next) {
	const result = await productions.updateScriptStatus(req.params.id as string, req.body.status, req.cfAuth!.id);
	return res.json(result);
}));

api.patch('/ap/games/:id/production/game_status', cfAuth(), restrictToGameEditorOrPermission, catchErrors(async function (req, res, next) {
	const result = await productions.updateGameStatus(req.params.id as string, req.body.status, req.cfAuth!.id);
	return res.json(result);
}));

api.patch('/ap/games/:id/production/fields', cfAuth(), restrictToGameEditorOrPermission, catchErrors(async function (req, res, next) {
	const result = await productions.updateProductionFields(req.params.id as string, req.body, req.cfAuth!.id);
	return res.json(result);
}));

api.get('/ap/games/:id/schedule', cfAuth(), permission('schedule.view'), catchErrors(async function (req, res, next) {
	const result = await games.getScheduleInfoForGame(req.params.id as string);
	return res.json(result);
}));

api.get('/ap/games/:id/broadcast', cfAuth(), permission('schedule.view'), catchErrors(async function (req, res, next) {
	const result = await games.getBroadcastForGame(req.params.id as string);
	return res.json(result);
}));

api.get('/ap/games/:id/wins', cfAuth(), permission('schedule.view'), catchErrors(async function (req, res, next) {
	const result = await games.getWinsFromGame(req.params.id as string);
	return res.json(result);
}));

api.patch('/ap/games/:id/wins', cfAuth(), permission('wins.edit'), catchErrors(async function (req, res, next) {
	const result = await wins.massEditWinsForGame(req.params.id as string, req.body, req.cfAuth!.id);
	return res.json(result);
}));

api.route('/ap/games/:id/meta')
	.get(cfAuth(), permission('schedule.view'), catchErrors(async function (req, res, next) {
		const result = await games.getMetaForGame(req.params.id as string);
		return res.json(result);
	}))
	.patch(cfAuth(), restrictToGameEditorOrPermission, catchErrors(async function (req, res, next) {
		const result = await games.updateMetaForGame(req.params.id as string, req.cfAuth!.id, req.body);
		return res.json(result);
	}));

api.get('/ap/games/:id/outlineChat', cfAuth(), restrictToGameHostOrProducer, catchErrors(async function (req, res, next) {
	const result = await games.getOutlineChat(req.params.id as string);
	return res.json(result);
}));

api.patch('/ap/games/:id/outlineChat/:messageId', cfAuth(), restrictToGameHostOrProducer, catchErrors(async function (req, res, next) {
	if (!req.body.message || typeof req.body.message !== 'string') {
		throw new HqError('Message is required', 400, 400);
	}
	const result = await games.editOutlineChatMessage(req.params.id as string, req.params.messageId, req.body.message, req.cfAuth!.userId);
	return res.json(result);
}));

api.post('/ap/refreshSeason', cfAuth(), permission('devops.edit'), catchErrors(async function (req, res, next) {
	const result = await seasonXp.refreshSeason();
	return res.json(result);
}));

api.route('/ap/season')
	.get(cfAuth(), permission('season.view'), catchErrors(async function (req, res, next) {
		const result = await season.getSeasonConfig();
		return res.json(result);
	}))
	.put(cfAuth(), permission('season.edit'), catchErrors(async function (req, res, next) {
		const result = await season.updateSeasonConfig(req.cfAuth!.userId, req.body);
		return res.json(result);
	}))
	.patch(cfAuth(), permission('season.edit'), catchErrors(async function (req, res, next) {
		const result = await season.updateSeasonConfig(req.cfAuth!.userId, req.body);
		return res.json(result);
	}));

api.get('/ap/season/metrics', cfAuth(), permission('season.view'), catchErrors(async function (req, res, next) {
	const result = await season.getSeasonMetrics();
	return res.json(result);
}));

api.route('/ap/season/users/:userId/points')
	.patch(cfAuth(), permission('season.edit'), catchErrors(async function (req, res, next) {
		const userId = Number(req.params.userId);
		if (Number.isNaN(userId)) {
			throw new HqError('Invalid user ID', 0, 400);
		}
		const result = await season.updateUserSeasonPoints(req.cfAuth!.userId, userId, req.body);
		return res.json(result);
	}));

api.route('/ap/season/levels')
	.get(cfAuth(), permission('season.view'), catchErrors(async function (req, res, next) {
		const result = await season.getSeasonLevels();
		return res.json(result);
	}))
	.post(cfAuth(), permission('season.edit'), catchErrors(async function (req, res, next) {
		const result = await season.createSeasonLevel(req.cfAuth!.userId, req.body);
		return res.json(result);
	}))
	.put(cfAuth(), permission('season.edit'), catchErrors(async function (req, res, next) {
		const result = await season.replaceSeasonLevels(req.cfAuth!.userId, req.body);
		return res.json(result);
	}));

api.post('/ap/season/levels/reorder', cfAuth(), permission('season.edit'), catchErrors(async function (req, res, next) {
	const result = await season.reorderSeasonLevels(req.cfAuth!.userId, req.body);
	return res.json(result);
}));

api.route('/ap/season/levels/:itemId')
	.patch(cfAuth(), permission('season.edit'), catchErrors(async function (req, res, next) {
		const itemId = Number(req.params.itemId);
		if (Number.isNaN(itemId)) {
			throw new HqError('Invalid level itemId', 0, 400);
		}
		const result = await season.updateSeasonLevel(req.cfAuth!.userId, itemId, req.body);
		return res.json(result);
	}))
	.delete(cfAuth(), permission('season.edit'), catchErrors(async function (req, res, next) {
		const itemId = Number(req.params.itemId);
		if (Number.isNaN(itemId)) {
			throw new HqError('Invalid level itemId', 0, 400);
		}
		const result = await season.deleteSeasonLevel(req.cfAuth!.userId, itemId);
		return res.json(result);
	}));

api.get('/ap/broadcasts', cfAuth(), permission('game.view'), catchErrors(async function (req, res, next) {
	const result = await broadcasts.listRunningBroadcasts();
	return res.json(result);
}));

api.get('/ap/broadcasts/:id/chat', cfAuth(), permission('game.view'), catchErrors(async function (req, res, next) {
	const result = await broadcasts.getChat(req.params.id);
	return res.json(result);
}));


const validateBroadcastAndCheckPermissions = catchErrors(async function (req: express.Request, res: express.Response, next: express.NextFunction) {
	const broadcastId = +req.params.id;
	const broadcast = await Broadcast.findOne({ where: { broadcastId, ended: null } });
	if (!broadcast) {
		throw new HqError('Broadcast not found or has ended', 0, 404);
	}
	
	// Check if user is host/producer (similar to restrictToGameHostOrProducer but with broadcastId)
	if (req.cfAuth) {
		const gameId = broadcast.gameId.toString();
		req.params.gameId = gameId;
		await restrictToGameHostOrProducer(req, res, next);
	} else {
		next();
	}
});

const setupRateLimitLock = catchErrors(async function (req: express.Request, res: express.Response, next: express.NextFunction) {
	const broadcastId = +req.params.id;
	const config = await getGeneralConfig();
	const lockAcquired = await redis.set(rGameKey(broadcastId).runCommandLock, 1, { NX: true, EX: config.runCommandLockExpirySec });
	if (!lockAcquired) {
		throw new HqError('Rate limited', 0, 400);
	}
	next();
});

api.get('/ap/broadcasts/:id/questions/:questionId/answerCounts', cfAuth(), validateBroadcastAndCheckPermissions, catchErrors(async function (req, res, next) {
	const result = await broadcasts.getQuestionAnswerCounts(req.params.id, req.params.questionId);
	return res.json(result);
}));

api.get('/ap/broadcasts/:id/questions/:questionId/answers/:answerId/players', cfAuth(), validateBroadcastAndCheckPermissions, catchErrors(async function (req, res, next) {
	const result = await broadcasts.getQuestionAnswerPlayers(req.params.id, req.params.questionId, req.params.answerId);
	return res.json(result);
}));

api.get('/ap/broadcasts/:id/questions/:questionId/extraLifeCount', cfAuth(), validateBroadcastAndCheckPermissions, catchErrors(async function (req, res, next) {
	const result = await broadcasts.getQuestionExtraLifeCount(req.params.id, req.params.questionId);
	return res.json(result);
}));

api.get('/ap/broadcasts/:id/puzzles/:questionId/extraLifeCount', cfAuth(), validateBroadcastAndCheckPermissions, catchErrors(async function (req, res, next) {
	const result = await broadcasts.getQuestionExtraLifeCount(req.params.id, req.params.questionId);
	return res.json(result);
}));

api.get('/ap/broadcasts/:id/questions/:questionId/status', cfAuth(), validateBroadcastAndCheckPermissions, catchErrors(async function (req, res, next) {
	const result = await broadcasts.getQuestionStatus(req.params.id, req.params.questionId);
	return res.json(result);
}));

api.get('/ap/broadcasts/:id/surveys/:surveyQuestionId/status', cfAuth(), validateBroadcastAndCheckPermissions, catchErrors(async function (req, res, next) {
	const result = await broadcasts.getSurveyStatus(req.params.id, req.params.surveyQuestionId);
	return res.json(result);
}));

api.get('/ap/broadcasts/:id/surveys/:surveyQuestionId/counts', cfAuth(), validateBroadcastAndCheckPermissions, catchErrors(async function (req, res, next) {
	const result = await broadcasts.getSurveyCounts(req.params.id, req.params.surveyQuestionId);
	return res.json(result);
}));

api.get('/ap/broadcasts/:id/wheel/status', cfAuth(), validateBroadcastAndCheckPermissions, catchErrors(async function (req, res, next) {
	const result = await broadcasts.getWheelStatus(req.params.id);
	return res.json(result);
}));

api.get('/ap/broadcasts/:id/wheel/superSpinCount', cfAuth(), validateBroadcastAndCheckPermissions, catchErrors(async function (req, res, next) {
	const result = await broadcasts.getWheelSuperSpinCount(req.params.id);
	return res.json(result);
}));

api.get('/ap/broadcasts/:id/questions/:questionId/eliminated', cfAuth(), validateBroadcastAndCheckPermissions, catchErrors(async function (req, res, next) {
	const result = await broadcasts.getQuestionEliminatedPlayers(req.params.id, req.params.questionId);
	return res.json(result);
}));

api.get('/ap/broadcasts/:id/questions/:questionId/saved', cfAuth(), validateBroadcastAndCheckPermissions, catchErrors(async function (req, res, next) {
	const result = await broadcasts.getQuestionSavedPlayers(req.params.id, req.params.questionId);
	return res.json(result);
}));

api.get('/ap/broadcasts/:id/checkpoints/:checkpointId/status', cfAuth(), validateBroadcastAndCheckPermissions, catchErrors(async function (req, res, next) {
	const result = await broadcasts.getCheckpointStatus(req.params.id, req.params.checkpointId);
	return res.json(result);
}));

api.get('/ap/broadcasts/:id/checkpoints/:checkpointId', cfAuth(), validateBroadcastAndCheckPermissions, catchErrors(async function (req, res, next) {
	const result = await broadcasts.getCheckpointInfo(req.params.id, req.params.checkpointId);
	return res.json(result);
}));

api.get('/ap/broadcasts/:id/checkpoints/:checkpointId/takers', cfAuth(), validateBroadcastAndCheckPermissions, catchErrors(async function (req, res, next) {
	const result = await broadcasts.getCheckpointTakers(req.params.id, req.params.checkpointId);
	return res.json(result);
}));

api.get('/ap/broadcasts/:id/winners', cfAuth(), validateBroadcastAndCheckPermissions, catchErrors(async function (req, res, next) {
	const result = await broadcasts.getWinners(req.params.id);
	return res.json(result);
}));

api.get('/ap/broadcasts/:id/winners/status', cfAuth(), validateBroadcastAndCheckPermissions, catchErrors(async function (req, res, next) {
	const result = await broadcasts.getWinnersStatus(req.params.id);
	return res.json(result);
}));

api.get('/ap/broadcasts/:id/questions/:questionId/extraLifePlayers', cfAuth(), validateBroadcastAndCheckPermissions, catchErrors(async function (req, res, next) {
	const result = await broadcasts.getQuestionExtraLifePlayers(req.params.id, req.params.questionId);
	return res.json(result);
}));

api.get('/ap/broadcasts/:id/puzzles/:questionId/extraLifePlayers', cfAuth(), validateBroadcastAndCheckPermissions, catchErrors(async function (req, res, next) {
	const result = await broadcasts.getQuestionExtraLifePlayers(req.params.id, req.params.questionId);
	return res.json(result);
}));

api.post('/ap/broadcasts/:id/questions/:questionId/answers/:answerId/revive', cfAuth(), validateBroadcastAndCheckPermissions, setupRateLimitLock, catchErrors(async function (req, res, next) {
	const result = await broadcasts.revivePlayersByAnswer(req.params.id, req.params.questionId, req.params.answerId);
	return res.json(result);
}));

api.post('/ap/broadcasts/:id/chatAnnounce/private/:userId(\\d+)', cfAuth(), authorise(), restrictToAdmin, validateBroadcastAndCheckPermissions, setupRateLimitLock, catchErrors(async function (req, res, next) {
	const broadcastId = +req.params.id;
	const userId = +req.params.userId;
	
	if (!req.body.message || typeof req.body.message !== 'string') {
		throw new HqError('Message is required', 400, 400);
	}
	
	const result = await runGameCommand('privateChatAnnounce', broadcastId, { userId, message: req.body.message });
	return res.json(result);
}));

api.get('/ap/transactions', cfAuth(), permission('players.view'), catchErrors(async function (req, res, next) {
	const result = await users.getRecentItemHistory();
	return res.json(result);
}));

api.get('/ap/transactions/:id', cfAuth(), permission('players.view'), catchErrors(async function (req, res, next) {
	const result = await users.getItemHistoryDetails(req.params.id as string);
	return res.json(result);
}));

api.get('/ap/payouts', cfAuth(), permission('payouts.view'), catchErrors(async function (req, res, next) {
	const result = await wins.getAllRecentPayouts();
	return res.json(result);
}));

api.route('/ap/payouts/:id')
	.get(cfAuth(), permission('payouts.view'), catchErrors(async function (req, res, next) {
		const result = await wins.getPayout(req.params.id);
		return res.json(result);
	}))
	.post(cfAuth(), permission('payouts.edit'), catchErrors(async function (req, res, next) {
		const result = await wins.updatePaidStatusOfPayout(req.params.id, req.cfAuth!.userId, req.body.paid);
		return res.json(result);
	}));

api.get('/ap/payouts/:id/audit', cfAuth(), permission('payouts.view'), catchErrors(async function (req, res, next) {
	const result = await wins.getHistoryOfPayout(req.params.id);
	return res.json(result);
}));

api.get('/ap/games/schedule/data', cfAuth(), permission('schedule.view'), catchErrors(async function (req, res, next) {
	const result = await games.getSchedulePageData();
	return res.json(result);
}));

api.get('/ap/schedule', cfAuth(), permission('schedule.view'), catchErrors(async function (req, res, next) {
	const result = await adminPanel.getSchedule();
	return res.json(result);
}));

api.route('/ap/schedule/:id')
	.patch(cfAuth(), restrictToGameScheduleEditorOrPermission, catchErrors(async function (req, res, next) {
		const result = await schedule.editScheduleItem(req.params.id as string, req.body);
		return res.json(result);
	}))
	.delete(cfAuth(), restrictToGameScheduleEditorOrPermission, catchErrors(async function (req, res, next) {
		const result = await schedule.deleteScheduleItem(req.params.id, req.cfAuth!.id);
		return res.json(result);
	}));

api.post('/ap/shows', cfAuth(), permission('shows.edit'), validate(require('../validation/showCreate'), {}, {}), catchErrors(async function (req, res, next) {
	const result = await adminPanel.createShow(req.cfAuth!.userId, req.body);
	return res.json(result);
}));

api.post('/ap/shows/batch', cfAuth(), permission('shows.view'), catchErrors(async function (req, res, next) {
	if (!req.body.showTypes || !Array.isArray(req.body.showTypes)) {
		throw new HqError('showTypes must be an array', 0, 400);
	}
	const result = await adminPanel.getShowTypesBatch(req.body.showTypes);
	return res.json({ data: result });
}));

api.route('/ap/shows/:type')
	.get(cfAuth(), permission('shows.view'), catchErrors(async function (req, res, next) {
		const result = await adminPanel.getShowType(req.params.type);
		return res.json(result);
	}))
	.patch(cfAuth(), permission('shows.edit'),  validate(require('../validation/show'), {}, {}), catchErrors(async function (req, res, next) {
		const result = await adminPanel.updateShowType(req.params.type, req.body);
		return res.json(result);
	}))
	.delete(cfAuth(), permission('shows.edit'), catchErrors(async function (req, res, next) {
		const result = await adminPanel.deleteShow(req.params.type, req.cfAuth!.id);
		return res.json(result);
	}));

api.get('/ap/wins', cfAuth(), permission('wins.view'), catchErrors(async function (req, res, next) {
	const result = await wins.getAllRecentWins();
	return res.json(result);
}));

api.route('/ap/wins/:id')
	.get(cfAuth(), permission('wins.view'), catchErrors(async function (req, res, next) {
		const result = await wins.getWin(req.params.id);
		return res.json(result);
	}))
	.post(cfAuth(), permission('wins.edit'), catchErrors(async function (req, res, next) {
		const result = await wins.changeFreezeStatusOfWin(req.params.id, req.body.frozen, req.cfAuth!.id);
		return res.json(result);
	}));

api.route('/ap/categories')
	.get(cfAuth(), catchErrors(async function (req, res, next) {
		const result = await employees.getCategories();
		return res.json(result);
	}))
	.post(cfAuth(), permission('employees.edit'), catchErrors(async function (req, res, next) {
		const result = await employees.createEmployeeCategory(req.body.name, req.cfAuth!.id);
		return res.json(result);
	}));

api.route('/ap/categories/:categorySlug')
	.patch(cfAuth(), permission('employees.edit'), catchErrors(async function (req, res, next) {
		const result = await employees.renameEmployeeCategory(req.params.categorySlug, req.body.name, req.cfAuth!.id);
		return res.json(result);
	}))
	.delete(cfAuth(), permission('employees.edit'), catchErrors(async function (req, res, next) {
		const result = await employees.deleteEmployeeCategory(req.params.categorySlug, req.cfAuth!.id);
		return res.json(result);
	}));

api.put('/ap/categories/order', cfAuth(), permission('employees.edit'), catchErrors(async function (req, res, next) {
	const result = await employees.reorderEmployeeCategories(req.body.order, req.cfAuth!.id);
	return res.json(result);
}));

api.route('/ap/categories/:categorySlug/permissions')
	.get(cfAuth(), permission('permissions.edit'), catchErrors(async function (req, res, next) {
		const result = await employees.getCategoryPermissions(req.params.categorySlug);
		return res.json(result);
	}))
	.patch(cfAuth(), permission('permissions.edit'), catchErrors(async function (req, res, next) {
		const result = await employees.setCategoryPermissions(req.params.categorySlug, req.cfAuth!.userId, req.body.permissions);
		return res.json(result);
	}));

api.get('/ap/employees', cfAuth(), permission('employees.view'), catchErrors(async function (req, res, next) {
	const result = await employees.getEmployees(req.query.search as string);
	return res.json(result);
}));

api.get('/ap/employees/basic', cfAuth(), permission('employees.view'), catchErrors(async function (req, res, next) {
	const result = await employees.getEmployeesBasic();
	return res.json({ data: result });
}));
api.get('/ap/employees/discord-search', cfAuth(), permission('employees.view'), catchErrors(async function (req, res, next) {
	const result = await employees.searchDiscordEmployees(
		req.query.query ?? req.query.search ?? req.query.term,
		req.query.limit
	);
	return res.json(result);
}));

api.get('/ap/employees/me', cfAuth(), catchErrors(async function (req, res, next) {
	const result = await employees.getEmployee(req.cfAuth!.userId);
	return res.json(result);
}));

api.post('/ap/employees', cfAuth(), permission('employees.edit'), validate(require('../validation/employeeCreate'), {}, {}), catchErrors(async function (req, res, next) {
	const result = await employees.createEmployee(req.cfAuth!.userId, req.body);
	return res.json(result);
}));

api.route('/ap/employees/:userId')
	.get(cfAuth(), catchErrors(async function (req, res, next) {
		const result = await employees.getEmployee(req.params.userId);
		return res.json(result);
	}))
	.put(cfAuth(), permission('employees.edit'), catchErrors(async function (req, res, next) {
		const result = await employees.updateEmployee(req.params.userId, req.cfAuth!.userId, req.body);
		return res.json(result);
	}))
	.delete(cfAuth(), permission('employees.edit'), catchErrors(async function (req, res, next) {
		const result = await employees.removeEmployee(req.params.userId, req.cfAuth!.userId, req.body.reason);
		return res.json(result);
	}));

api.route('/ap/employees/:userId/permissions')
	.get(cfAuth(), selfOrPermission('employees.edit'), catchErrors(async function (req, res, next) {
		const result = await employees.getEmployeePermissions(req.params.userId);
		return res.json(result);
	}))
	.patch(cfAuth(), permission('permissions.edit'), catchErrors(async function (req, res, next) {
		const result = await employees.setEmployeePermissions(req.params.userId, req.cfAuth!.userId, req.body.permissions);
		return res.json(result);
	}));

api.get('/ap/employees/:userId/audit', cfAuth(), catchErrors(async function (req, res, next) {
	const result = await employees.getAudit(req.params.userId);
	return res.json(result);
}));

api.get('/ap/employees/:userId/stream', cfAuth(), catchErrors(async function (req, res, next) {
	const result = await employees.getEmployeeStreamCredentials(req.params.userId, req.cfAuth!.userId ?? req.cfAuth!.id);
	return res.json(result);
}));

api.get('/ap/employees/:userId/assignments', cfAuth(), permission('game.view'), catchErrors(async function (req, res, next) {
	const result = await employees.getAssignments(req.params.userId);
	return res.json(result);
}));

api.get('/ap/devops/servers', cfAuth(), permission('devops.view'), catchErrors(async function (req, res, next) {
	const result = await devops.getServers();
	return res.json(result);
}));

api.get('/ap/devops/instance_sizes', cfAuth(), permission('devops.view'), catchErrors(async function (req, res, next) {
	const result = await devops.getInstanceSizes();
	return res.json(result);
}));

api.get('/ap/devops/servers/:id/audit', cfAuth(), permission('devops.view'), catchErrors(async function (req, res, next) {
	const result = await devops.getServerStatusAudit(req.params.id);
	return res.json(result);
}));

api.get('/ap/devops/servers/:server/bootStatus', cfAuth(), permission('devops.view'), catchErrors(async function (req, res, next) {
	const result = await devops.getBootStatusOfServer(req.params.server);
	return res.send(result); // send instead of json
}));

api.post('/ap/devops/servers/hls/bootStatus', catchErrors(async function (req, res, next) {
	const result = await devops.setHlsStatusToBooted(req.headers['authorization']);
	return res.json(result);
}));

api.post('/ap/devops/servers/stream/bootStatus', catchErrors(async function (req, res, next) {
	const result = await devops.setStreamStatusToBooted(req.headers['authorization']);
	return res.json(result);
}));

api.post('/ap/devops/stream/boot', cfAuth(), permission('devops.edit'), catchErrors(async function (req, res, next) {
	const result = await devops.bootStreamServer(req.cfAuth!.userId);
	return res.json(result);
}));

api.post('/ap/devops/stream/destroy', cfAuth(), permission('devops.edit'), catchErrors(async function (req, res, next) {
	const result = await devops.destroyStream(req.cfAuth!.userId);
	return res.json(result);
}));

api.post('/ap/devops/stream/destroyInactive', catchErrors(async function (req, res, next) {
	const result = await devops.destroyStream(req.headers['authorization'], true);
	return res.json(result);
}));

api.post('/ap/devops/stream/started', catchErrors(async function (req, res, next) {
	const result = await devops.changeStreamState(req.query.username as string, 'started', req.headers['authorization']);
	return res.json(result);
}));

api.post('/ap/devops/stream/authenticate', catchErrors(async function (req, res, next) {
	const result = await devops.authenticateStream(req.body.streamKey, req.headers['authorization']);
	return res.json(result);
}));

api.post('/ap/devops/stream/ended', catchErrors(async function (req, res, next) {
	const result = await devops.changeStreamState(req.query.username as string, 'ended', req.headers['authorization']);
	return res.json(result);
}));

api.post('/ap/devops/socket/boot', cfAuth(), permission('devops.edit'), catchErrors(async function (req, res, next) {
	const result = await devops.bootSocket(req.cfAuth!.userId);
	return res.json(result);
}));

api.post('/ap/devops/socket/destroy', cfAuth(), permission('devops.edit'), catchErrors(async function (req, res, next) {
	const result = await devops.destroySocket(req.cfAuth!.userId);
	return res.json(result);
}));

api.post('/ap/devops/socket/scale', cfAuth(), permission('devops.edit'), catchErrors(async function (req, res, next) {
	const result = await devops.scaleSocket(req.body.count, req.body.size, req.cfAuth!.userId);
	return res.json(result);
}));

api.post('/ap/devops/api/scale', cfAuth(), permission('devops.edit'), catchErrors(async function (req, res, next) {
	const result = await devops.scaleApi(req.body.count, req.body.size, req.cfAuth!.userId);
	return res.json(result);
}));

api.post('/ap/devops/hls/scale', cfAuth(), permission('devops.edit'), catchErrors(async function (req, res, next) {
	const result = await devops.scaleHlsStream(req.body.count, req.body.size, req.cfAuth!.userId);
	return res.json(result);
}));

api.get('/ap/users/basic', cfAuth(), permission('users.view'), catchErrors(async function (req, res, next) {
	const result = await users.getUsersBasic();
	return res.json({ data: result });
}));

api.get('/ap/users', cfAuth(), permission('users.view'), catchErrors(async function (req, res, next) {
	// Parse filter options
	const filters: {
		purged?: boolean;
		admin?: boolean;
		tester?: boolean;
		booster?: boolean;
		chatBan?: boolean;
		gameBan?: boolean;
		appBan?: boolean;
	} = {};

	if (req.query.purged !== undefined) {
		filters.purged = req.query.purged === 'true' || req.query.purged === '1';
	}
	if (req.query.admin !== undefined) {
		filters.admin = req.query.admin === 'true' || req.query.admin === '1';
	}
	if (req.query.tester !== undefined) {
		filters.tester = req.query.tester === 'true' || req.query.tester === '1';
	}
	if (req.query.booster !== undefined) {
		filters.booster = req.query.booster === 'true' || req.query.booster === '1';
	}
	if (req.query.chatBan !== undefined) {
		filters.chatBan = req.query.chatBan === 'true' || req.query.chatBan === '1';
	}
	if (req.query.gameBan !== undefined) {
		filters.gameBan = req.query.gameBan === 'true' || req.query.gameBan === '1';
	}
	if (req.query.appBan !== undefined) {
		filters.appBan = req.query.appBan === 'true' || req.query.appBan === '1';
	}

	// Parse sort options
	const sort: {
		sortBy?: 'name' | 'created' | 'id' | 'lastOnline';
		sortOrder?: 'ASC' | 'DESC';
	} = {};

	if (req.query.sortBy) {
		const sortBy = req.query.sortBy as string;
		if (['name', 'created', 'id', 'lastOnline'].includes(sortBy)) {
			sort.sortBy = sortBy as 'name' | 'created' | 'id' | 'lastOnline';
		}
	}
	if (req.query.sortOrder) {
		const sortOrder = req.query.sortOrder as string;
		if (['ASC', 'DESC'].includes(sortOrder.toUpperCase())) {
			sort.sortOrder = sortOrder.toUpperCase() as 'ASC' | 'DESC';
		}
	}

	const result = await adminPanel.getUsersTEMP(
		req.query.q as string | null,
		req.offset,
		Object.keys(filters).length > 0 ? filters : undefined,
		Object.keys(sort).length > 0 ? sort : undefined
	);
	
	// Convert Account instances to plain objects for pagination
	const dataAsRecords = result.data.map(user => user.toJSON ? user.toJSON() : user) as Record<string, unknown>[];
	
	// Add pagination links
	const paginated = paginateData(req, dataAsRecords);
	
	return res.json({
		...paginated,
		hasMore: result.hasMore
	});
}));

api.get('/ap/users/:userId', cfAuth(), catchErrors(async function (req, res, next) {
	const user = await getUser(+req.params.userId);
	const profile = await getProfileFullPrivate(user);
	if (profile && (profile as { phoneNumber?: string }).phoneNumber) {
		delete (profile as { phoneNumber?: string }).phoneNumber;
	}
	// Add ban status fields for admin panel only
	res.json({
		...profile,
		chatBan: user.chatBan,
		gameBan: user.gameBan,
		appBan: user.appBan
	});
}));

api.delete('/ap/users/:userId/cache', cfAuth(), permission('devops.edit'), catchErrors(async function (req, res, next) {
	const result = await getUser(+req.params.userId, true);
	return res.json(result);
}));

api.route('/ap/users/:userId/avatar').patch(cfAuth(), permission('users.edit'), bodyParser.raw({ inflate: true, limit: "8mb", type: "image/*", }), catchErrors(async function (req, res, next) {
	const result = await adminPanel.updateAvatarFromAP(req.params.userId, req.cfAuth!.userId, req.body, req.headers);
	return res.json(result);
})).delete(cfAuth(), permission('users.edit'), catchErrors(async function (req, res, next) {
	const result = await adminPanel.deleteAvatarFromAP(req.params.userId, req.cfAuth!.userId);
	return res.json(result);
}));

api.post('/ap/users/:userId/username', cfAuth(), permission('users.edit'), catchErrors(async function (req, res, next) {
	const result = await userUpdaters.changeUsername(+req.params.userId, req.body.username, { employeeId: req.cfAuth!.id });
	return res.json(result);
}));

api.post('/ap/users/:userId/purge', cfAuth(), permission('users.edit'), catchErrors(async function (req, res, next) {
	const result = await userUpdaters.purgeUser(req.params.userId, req.cfAuth!.userId);
	return res.json(result);
}));

api.post('/ap/users/:userId/permissions', cfAuth(), permission('permissions.edit'), catchErrors(async function (req, res, next) {
	const result = await userUpdaters.setUserPermission(req.params.userId, req.body.admin, req.body.tester, req.body.booster, req.cfAuth!.userId);
	return res.json(result);
}));

api.post('/ap/users/:userId/chatBan', cfAuth(), permission('users.edit'), catchErrors(async function (req, res, next) {
	const result = await userUpdaters.setUserChatBan(req.params.userId, req.body.level, req.cfAuth!.userId);
	return res.json(result);
}));

api.post('/ap/users/:userId/gameBan', cfAuth(), permission('users.edit'), catchErrors(async function (req, res, next) {
	const result = await userUpdaters.setUserGameBan(req.params.userId, req.body.level, req.cfAuth!.userId);
	return res.json(result);
}));

api.post('/ap/users/:userId/appBan', cfAuth(), permission('users.edit'), catchErrors(async function (req, res, next) {
	const result = await userUpdaters.setUserAppBan(req.params.userId, req.body.banned, req.cfAuth!.userId);
	return res.json(result);
}));

api.get('/ap/users/:userId/pii', cfAuth(), permission('pii.view'), catchErrors(async function (req, res, next) {
	const result = await users.getPhoneNumber(req.params.userId, { employeeId: req.cfAuth!.userId });
	return res.json(result);
}));

api.delete('/ap/users/:userId/pin', cfAuth(), permission('pii.edit'), catchErrors(async function (req, res, next) {
	const result = await userUpdaters.resetUserPin(req.params.userId, req.cfAuth!.userId);
	return res.json(result);
}));

api.patch('/ap/users/:userId/phone', cfAuth(), permission('pii.edit'), catchErrors(async function (req, res, next) {
	const result = await userUpdaters.changeUserPhoneNumber(req.params.userId, req.body.phone, req.cfAuth!.userId);
	return res.json(result);
}));

api.get('/ap/users/:userId/gamesPlayed', cfAuth(), permission('users.detailedView'), catchErrors(async function (req, res, next) {
	const result = await users.getGamesPlayed(req.params.userId);
	return res.json(result);
}));

api.get('/ap/users/:userId/friends', cfAuth(), permission('users.detailedView'), catchErrors(async function (req, res, next) {
	const result = await friends.getAllFriendStatuses(req.params.userId);
	return res.json(result);
}));

api.get('/ap/users/:userId/transactions', cfAuth(), permission('users.detailedView'), catchErrors(async function (req, res, next) {
	const result = await users.getItemHistory(req.params.userId);
	return res.json(result);
}));

api.get('/ap/users/:userId/audit', cfAuth(), permission('users.detailedView'), catchErrors(async function (req, res, next) {
	const result = await users.getAuditForUser(req.params.userId);
	return res.json(result);
}));

api.post('/ap/users/meta/batch', cfAuth(), catchErrors(async function (req, res, next) {
	if (!req.body.userIds || !Array.isArray(req.body.userIds)) {
		throw new HqError('userIds must be an array', 0, 400);
	}
	const result = await users.getUserMetadataBatch(req.body.userIds);
	return res.json({ data: result });
}));

api.get('/ap/users/:userId/meta', cfAuth(), catchErrors(async function (req, res, next) {
	const result = await users.getUserMetadata(req.params.userId);
	return res.json(result);
}));

api.get('/ap/users/:userId/offairTriviaGames', cfAuth(), permission('users.detailedView'), catchErrors(async function (req, res, next) {
	const result = await offairTrivia.getCompletedGameResults(req.params.userId);
	return res.json(result);
}));

api.get('/ap/users/:userId/wins', cfAuth(), permission('users.detailedView'), catchErrors(async function (req, res, next) {
	const result = await wins.getRecentWinsOfPlayer(req.params.userId);
	return res.json(result);
}));

api.get('/ap/users/:userId/balanceSummary', cfAuth(), permission('users.detailedView'), catchErrors(async function (req, res, next) {
	const result = await getBalanceSummary(+req.params.userId);
	return res.json(result);
}));

api.get('/ap/users/:userId/payouts', cfAuth(), permission('users.detailedView'), catchErrors(async function (req, res, next) {
	const result = await users.getPayouts(req.params.userId);
	return res.json(result);
}));

api.get('/ap/users/:userId/referrals', cfAuth(), permission('users.detailedView'), catchErrors(async function (req, res, next) {
	const result = await users.getReferrals(req.params.userId);
	return res.json(result);
}));

api.get('/ap/users/:userId/forensics', cfAuth(), permission('forensics.view'), catchErrors(async function (req, res, next) {
	const forceRefresh = req.query.refresh === 'true' || req.query.refresh === '1';
	const result = await users.getUserForensics(req.params.userId, forceRefresh);
	return res.json(result);
}));

api.delete('/ap/users/:userId/forensics/cache', cfAuth(), permission('forensics.view'), catchErrors(async function (req, res, next) {
	await users.clearUserForensicsCache(req.params.userId);
	return res.json({ success: true });
}));

api.get('/ap/forensics/metrics', cfAuth(), permission('forensics.view'), catchErrors(async function (req, res, next) {
	const result = await users.getForensicsMetrics();
	return res.json(result);
}));

api.post('/ap/forensics/run-all', cfAuth(), permission('forensics.view'), catchErrors(async function (req, res, next) {
	// Run forensics on all users (async - returns immediately)
	// The actual processing happens in the background
	const batchSize = req.body.batchSize ?? 10;
	
	// Start the process asynchronously (don't await)
	users.runForensicsOnAllUsers(batchSize, (processed, total, errors) => {
		logger.info(`Forensics batch progress: ${processed}/${total} (${errors} errors)`);
	}).catch(err => {
		logger.error({ err }, 'Failed to run forensics on all users');
	});
	
	return res.json({ 
		success: true, 
		message: 'Forensics analysis started on all users. Check logs for progress.',
		batchSize 
	});
}));

api.route('/ap/announcements')
	.get(cfAuth(), permission('announcements.view'), catchErrors(async function (req, res, next) {
		const result = await announcements.getAnnouncements();
		return res.json(result);
	}))
	.put(cfAuth(), permission('announcements.edit'), catchErrors(async function (req, res, next) {
		const result = await announcements.replaceAnnouncements(req.cfAuth!.userId, req.body);
		return res.json(result);
	}))
	.post(cfAuth(), permission('announcements.edit'), catchErrors(async function (req, res, next) {
		const result = await announcements.createAnnouncement(req.cfAuth!.userId, req.body);
		return res.json(result);
	}));

api.route('/ap/announcements/:index')
	.patch(cfAuth(), permission('announcements.edit'), catchErrors(async function (req, res, next) {
		const result = await announcements.updateAnnouncement(req.params.index, req.cfAuth!.userId, req.body);
		return res.json(result);
	}))
	.delete(cfAuth(), permission('announcements.edit'), catchErrors(async function (req, res, next) {
		const result = await announcements.deleteAnnouncement(req.params.index, req.cfAuth!.userId);
		return res.json(result);
	}));

api.post('/ap/announcements/reorder', cfAuth(), permission('announcements.edit'), catchErrors(async function (req, res, next) {
	const result = await announcements.reorderAnnouncements(req.cfAuth!.userId, req.body);
	return res.json(result);
}));

export default api;

import Audit from '../../common/database/adminModels/audit';
import GeneralConfig from '../../common/database/configModels/generalConfig';
import KeepPlayingConfig from '../../common/database/configModels/keepPlayingConfig';
import LiveConfig from '../../common/database/configModels/liveConfig';
import OffairTriviaConfig from '../../common/database/configModels/offairTriviaConfig';
import StreakConfig from '../../common/database/configModels/streakConfig';
import HqError from '../../common/hqError';
import redis from '../../common/redisClient';
import rKey from '../../common/redisKeys';
import getStreakConfigFromCache from '../../common/utils/getStreakConfig';
import getKeepPlayingConfigFromCache from '../../websocket/helpers/getKeepPlayingConfig';
import getGeneralConfigFromCache from '../utils/getGeneralConfig';
import getOffairTriviaConfigFromCache from '../utils/getOffairTriviaConfig';
import { getMainConfig as getMainConfigFromCache, getPublicConfig as getPublicConfigFromCache } from './configGetters';

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

function coerceOptionalNumber(value: unknown, field: string): number | null {
	if (value === null || value === undefined || value === '') {
		return null;
	}
	return coerceNumber(value, field);
}

function coerceOptionalTinyInt(value: unknown, field: string): number | undefined {
	if (value === null || value === undefined || value === '') {
		return undefined;
	}
	return coerceTinyInt(value, field);
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
		subToType: 'config',
		from: String(options.employeeId),
		fromType: 'employee',
		action: options.action,
		description: formatAuditDescription(options.action, options.details)
	});
}

export async function getKeepPlayingConfig() {
	return getKeepPlayingConfigFromCache();
}

export async function setKeepPlayingConfig(employeeId: string | number, body: unknown) {
	const input = ensureBodyObject(body);
	const payload = {
		enabled: coerceTinyInt(input.enabled, 'enabled'),
		baseCoins: coerceNumber(input.baseCoins, 'baseCoins'),
		coinsPerRightAnswer: coerceNumber(input.coinsPerRightAnswer, 'coinsPerRightAnswer'),
		eraserChance: coerceNumber(input.eraserChance, 'eraserChance'),
		lifeChance: coerceNumber(input.lifeChance, 'lifeChance'),
		maxLives: coerceNumber(input.maxLives, 'maxLives'),
		maxErasers: coerceNumber(input.maxErasers, 'maxErasers'),
		consecutiveChanceMulti: coerceNumber(input.consecutiveChanceMulti, 'consecutiveChanceMulti')
	};

	if (payload.enabled === 1) {
		await KeepPlayingConfig.update({ enabled: 0 }, { where: { enabled: 1 } });
	}
	const created = await KeepPlayingConfig.create(payload);
	await redis.del(rKey.keepPlayingConfig);
	const result = await getKeepPlayingConfigFromCache();

	await logConfigChange({
		subTo: 'keepPlaying',
		action: 'set_keepPlaying_config',
		employeeId,
		details: { ...payload, versionId: created.get('versionId') }
	});

	return result;
}

export async function getOffairTriviaConfig() {
	return getOffairTriviaConfigFromCache();
}

export async function setOffairTriviaConfig(employeeId: string | number, body: unknown) {
	const input = ensureBodyObject(body);
	const payload = {
		enabled: coerceTinyInt(input.enabled, 'enabled'),
		questionCount: coerceNumber(input.questionCount, 'questionCount'),
		correctCoins: coerceNumber(input.correctCoins, 'correctCoins'),
		correctPoints: coerceNumber(input.correctPoints, 'correctPoints'),
		completionCoins: coerceNumber(input.completionCoins, 'completionCoins'),
		nextGameWaitSec: coerceNumber(input.nextGameWaitSec, 'nextGameWaitSec'),
		nextGameWaitSecBooster: coerceNumber(input.nextGameWaitSecBooster, 'nextGameWaitSecBooster')
	};

	const created = await OffairTriviaConfig.create(payload);
	await redis.del(rKey.offairTriviaConfig);
	const result = await getOffairTriviaConfigFromCache();

	await logConfigChange({
		subTo: 'offairTrivia',
		action: 'set_offairTrivia_config',
		employeeId,
		details: { ...payload, versionId: created.get('versionId') }
	});

	return result;
}

export async function getStreakConfig() {
	return getStreakConfigFromCache();
}

export async function setStreakConfig(employeeId: string | number, body: unknown) {
	const input = ensureBodyObject(body);
	const payload = {
		streaksEnabled: coerceTinyInt(input.streaksEnabled, 'streaksEnabled'),
		streakTarget: coerceNumber(input.streakTarget, 'streakTarget'),
		streakWaitSec: coerceNumber(input.streakWaitSec, 'streakWaitSec'),
		absenseEndsStreak: coerceTinyInt(input.absenseEndsStreak, 'absenseEndsStreak'),
		streakExpirySec: coerceOptionalNumber(input.streakExpirySec, 'streakExpirySec')
	};

	const created = await StreakConfig.create(payload);
	await redis.del(rKey.streakConfig);
	const result = await getStreakConfigFromCache();

	await logConfigChange({
		subTo: 'streak',
		action: 'set_streak_config',
		employeeId,
		details: { ...payload, versionId: created.get('versionId') }
	});

	return result;
}

export async function getGeneralConfig() {
	return getGeneralConfigFromCache();
}

export async function setGeneralConfig(employeeId: string | number, body: unknown) {
	const input = ensureBodyObject(body);
	
	// Get current config to merge with provided values
	const currentConfig = await getGeneralConfigFromCache();
	
	// Validate generated columns only if provided (they're optional since they're generated)
	const makeItRainEnabled = input.makeItRainEnabled !== undefined 
		? coerceOptionalTinyInt(input.makeItRainEnabled, 'makeItRainEnabled')
		: currentConfig.makeItRainEnabled;
	const payoutsEnabled = input.payoutsEnabled !== undefined
		? coerceOptionalTinyInt(input.payoutsEnabled, 'payoutsEnabled')
		: currentConfig.payoutsEnabled;
	
	// Build payload by merging current config with provided values (only validate provided fields)
	const payload: Record<string, number> = {
		// makeItRainEnabled is a generated column, excluded from insert
		makeItRainIntervalSec: input.makeItRainIntervalSec !== undefined
			? coerceNumber(input.makeItRainIntervalSec, 'makeItRainIntervalSec')
			: currentConfig.makeItRainIntervalSec,
		// payoutsEnabled is a generated column, excluded from insert
		payoutThresholdCents: input.payoutThresholdCents !== undefined
			? coerceNumber(input.payoutThresholdCents, 'payoutThresholdCents')
			: currentConfig.payoutThresholdCents,
		// Rate Limiting
		apiRateLimitWindowSec: input.apiRateLimitWindowSec !== undefined
			? coerceNumber(input.apiRateLimitWindowSec, 'apiRateLimitWindowSec')
			: currentConfig.apiRateLimitWindowSec,
		apiRateLimitMaxRequests: input.apiRateLimitMaxRequests !== undefined
			? coerceNumber(input.apiRateLimitMaxRequests, 'apiRateLimitMaxRequests')
			: currentConfig.apiRateLimitMaxRequests,
		// Verification System
		verificationLockExpirySec: input.verificationLockExpirySec !== undefined
			? coerceNumber(input.verificationLockExpirySec, 'verificationLockExpirySec')
			: currentConfig.verificationLockExpirySec,
		verificationMaxRetries: input.verificationMaxRetries !== undefined
			? coerceNumber(input.verificationMaxRetries, 'verificationMaxRetries')
			: currentConfig.verificationMaxRetries,
		verificationExpiryMinutes: input.verificationExpiryMinutes !== undefined
			? coerceNumber(input.verificationExpiryMinutes, 'verificationExpiryMinutes')
			: currentConfig.verificationExpiryMinutes,
		verificationRetryWaitSec: input.verificationRetryWaitSec !== undefined
			? coerceNumber(input.verificationRetryWaitSec, 'verificationRetryWaitSec')
			: currentConfig.verificationRetryWaitSec,
		createAccountLockExpirySec: input.createAccountLockExpirySec !== undefined
			? coerceNumber(input.createAccountLockExpirySec, 'createAccountLockExpirySec')
			: currentConfig.createAccountLockExpirySec,
		// Payout/Balance Configuration
		winForfeitAfterDays: input.winForfeitAfterDays !== undefined
			? coerceNumber(input.winForfeitAfterDays, 'winForfeitAfterDays')
			: currentConfig.winForfeitAfterDays,
		// Request Timeouts
		apiRequestTimeoutSec: input.apiRequestTimeoutSec !== undefined
			? coerceNumber(input.apiRequestTimeoutSec, 'apiRequestTimeoutSec')
			: currentConfig.apiRequestTimeoutSec,
		// Employee Authentication
		employeeCacheExpiryHours: input.employeeCacheExpiryHours !== undefined
			? coerceNumber(input.employeeCacheExpiryHours, 'employeeCacheExpiryHours')
			: currentConfig.employeeCacheExpiryHours,
		// Offair Trivia
		offairTriviaLockExpirySec: input.offairTriviaLockExpirySec !== undefined
			? coerceNumber(input.offairTriviaLockExpirySec, 'offairTriviaLockExpirySec')
			: currentConfig.offairTriviaLockExpirySec,
		offairTriviaQuestionTimeToleranceSec: input.offairTriviaQuestionTimeToleranceSec !== undefined
			? coerceNumber(input.offairTriviaQuestionTimeToleranceSec, 'offairTriviaQuestionTimeToleranceSec')
			: currentConfig.offairTriviaQuestionTimeToleranceSec,
		offairTriviaReminderSendHours: input.offairTriviaReminderSendHours !== undefined
			? coerceNumber(input.offairTriviaReminderSendHours, 'offairTriviaReminderSendHours')
			: currentConfig.offairTriviaReminderSendHours,
		// WebSocket Server Intervals
		wsStatsUpdateIntervalSec: input.wsStatsUpdateIntervalSec !== undefined
			? coerceNumber(input.wsStatsUpdateIntervalSec, 'wsStatsUpdateIntervalSec')
			: currentConfig.wsStatsUpdateIntervalSec,
		wsIdleDisconnectIntervalSec: input.wsIdleDisconnectIntervalSec !== undefined
			? coerceNumber(input.wsIdleDisconnectIntervalSec, 'wsIdleDisconnectIntervalSec')
			: currentConfig.wsIdleDisconnectIntervalSec,
		wsChatRelayIntervalSec: input.wsChatRelayIntervalSec !== undefined
			? coerceNumber(input.wsChatRelayIntervalSec, 'wsChatRelayIntervalSec')
			: currentConfig.wsChatRelayIntervalSec,
		// Chat Cooldown
		chatCooldownSec: input.chatCooldownSec !== undefined
			? coerceNumber(input.chatCooldownSec, 'chatCooldownSec')
			: currentConfig.chatCooldownSec,
		// Background Jobs
		employeeAvatarRefreshIntervalDays: input.employeeAvatarRefreshIntervalDays !== undefined
			? coerceNumber(input.employeeAvatarRefreshIntervalDays, 'employeeAvatarRefreshIntervalDays')
			: currentConfig.employeeAvatarRefreshIntervalDays,
		forensicsJobCheckIntervalHours: input.forensicsJobCheckIntervalHours !== undefined
			? coerceNumber(input.forensicsJobCheckIntervalHours, 'forensicsJobCheckIntervalHours')
			: currentConfig.forensicsJobCheckIntervalHours,
		forensicsJobMinDaysBetweenRuns: input.forensicsJobMinDaysBetweenRuns !== undefined
			? coerceNumber(input.forensicsJobMinDaysBetweenRuns, 'forensicsJobMinDaysBetweenRuns')
			: currentConfig.forensicsJobMinDaysBetweenRuns,
		forensicsJobLockTTLHours: input.forensicsJobLockTTLHours !== undefined
			? coerceNumber(input.forensicsJobLockTTLHours, 'forensicsJobLockTTLHours')
			: currentConfig.forensicsJobLockTTLHours,
		// Game Locks
		extraLifeLockExpirySec: input.extraLifeLockExpirySec !== undefined
			? coerceNumber(input.extraLifeLockExpirySec, 'extraLifeLockExpirySec')
			: currentConfig.extraLifeLockExpirySec,
		eraserLockExpirySec: input.eraserLockExpirySec !== undefined
			? coerceNumber(input.eraserLockExpirySec, 'eraserLockExpirySec')
			: currentConfig.eraserLockExpirySec,
		// Broadcast Stats
		broadcastStatsRefreshIntervalMs: input.broadcastStatsRefreshIntervalMs !== undefined
			? coerceNumber(input.broadcastStatsRefreshIntervalMs, 'broadcastStatsRefreshIntervalMs')
			: currentConfig.broadcastStatsRefreshIntervalMs,
		broadcastStatsClearBeforeSec: input.broadcastStatsClearBeforeSec !== undefined
			? coerceNumber(input.broadcastStatsClearBeforeSec, 'broadcastStatsClearBeforeSec')
			: currentConfig.broadcastStatsClearBeforeSec,
		// Command Lock
		runCommandLockExpirySec: input.runCommandLockExpirySec !== undefined
			? coerceNumber(input.runCommandLockExpirySec, 'runCommandLockExpirySec')
			: currentConfig.runCommandLockExpirySec,
		// Broadcast Cache
		broadcastCacheExpirySec: input.broadcastCacheExpirySec !== undefined
			? coerceNumber(input.broadcastCacheExpirySec, 'broadcastCacheExpirySec')
			: currentConfig.broadcastCacheExpirySec,
		// Droplet Configuration
		dropletImage: input.dropletImage !== undefined
			? coerceNumber(input.dropletImage, 'dropletImage')
			: currentConfig.dropletImage
	};

	const created = await GeneralConfig.create(payload);
	await redis.del(rKey.generalConfig);
	const result = await getGeneralConfigFromCache();

	const auditDetails: SerializableRecord = { ...payload, versionId: created.get('versionId') };
	auditDetails.makeItRainEnabled = makeItRainEnabled;
	auditDetails.payoutsEnabled = payoutsEnabled;

	await logConfigChange({
		subTo: 'general',
		action: 'set_general_config',
		employeeId,
		details: auditDetails
	});

	return result;
}

export async function getMainConfig() {
	return getMainConfigFromCache();
}

export async function setMainConfig(employeeId: string | number, body: unknown) {
	const input = ensureBodyObject(body);
	await redis.set(rKey.mainConfig, JSON.stringify(input));
	const result = await getMainConfigFromCache();

	await logConfigChange({
		subTo: 'main',
		action: 'set_main_config',
		employeeId,
		details: input
	});

	return result;
}

export async function getPublicConfig() {
	return getPublicConfigFromCache();
}

export async function setPublicConfig(employeeId: string | number, body: unknown) {
	const input = ensureBodyObject(body);
	await redis.set(rKey.publicConfig, JSON.stringify(input));
	const result = await getPublicConfigFromCache();

	await logConfigChange({
		subTo: 'public',
		action: 'set_public_config',
		employeeId,
		details: input
	});

	return result;
}

export async function getAllLiveConfigs() {
	const liveConfigs = await LiveConfig.findAll({
		order: [['envName', 'ASC'], ['rehearsal', 'ASC']]
	});
	return liveConfigs.map(config => ({
		id: config.id,
		envName: config.envName,
		rehearsal: config.rehearsal,
		socketUrl: config.socketUrl,
		source: config.source,
		passthrough: config.passthrough,
		high: config.high,
		medium: config.medium,
		low: config.low,
		playlistUrl: config.playlistUrl
	}));
}


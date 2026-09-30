import GeneralConfig from '../../common/database/configModels/generalConfig';
import logger from '../../common/logger';
import redis from '../../common/redisClient';
import rKey from '../../common/redisKeys';

type GeneralConfigInstance = {
    makeItRainEnabled: number;
    makeItRainIntervalSec: number;
    payoutsEnabled: number;
    payoutThresholdCents: number;
    // Rate Limiting
    apiRateLimitWindowSec: number;
    apiRateLimitMaxRequests: number;
    // Verification System
    verificationLockExpirySec: number;
    verificationMaxRetries: number;
    verificationExpiryMinutes: number;
    verificationRetryWaitSec: number;
    createAccountLockExpirySec: number;
    // Payout/Balance Configuration
    winForfeitAfterDays: number;
    // Request Timeouts
    apiRequestTimeoutSec: number;
    // Employee Authentication
    employeeCacheExpiryHours: number;
    // Offair Trivia
    offairTriviaLockExpirySec: number;
    offairTriviaQuestionTimeToleranceSec: number;
    offairTriviaReminderSendHours: number;
    // WebSocket Server Intervals
    wsStatsUpdateIntervalSec: number;
    wsIdleDisconnectIntervalSec: number;
    wsChatRelayIntervalSec: number;
    // Chat Cooldown
    chatCooldownSec: number;
    // Background Jobs
    employeeAvatarRefreshIntervalDays: number;
    forensicsJobCheckIntervalHours: number;
    forensicsJobMinDaysBetweenRuns: number;
    forensicsJobLockTTLHours: number;
    // Game Locks
    extraLifeLockExpirySec: number;
    eraserLockExpirySec: number;
    // Broadcast Stats
    broadcastStatsRefreshIntervalMs: number;
    broadcastStatsClearBeforeSec: number;
    // Command Lock
    runCommandLockExpirySec: number;
    // Broadcast Cache
    broadcastCacheExpirySec: number;
    // Droplet Configuration
    dropletImage: number;
}

const generalDefault: GeneralConfigInstance = {
    makeItRainEnabled: 0,
    makeItRainIntervalSec: 0,
    payoutsEnabled: 1,
    payoutThresholdCents: 500,
    // Rate Limiting (default: 30 seconds window, 3 requests)
    apiRateLimitWindowSec: 30,
    apiRateLimitMaxRequests: 3,
    // Verification System (default: 5s lock, 3 retries, 20min expiry, 30s retry wait)
    verificationLockExpirySec: 5,
    verificationMaxRetries: 3,
    verificationExpiryMinutes: 20,
    verificationRetryWaitSec: 30,
    createAccountLockExpirySec: 5,
    // Payout/Balance Configuration (default: $5 thresholds, 90 days forfeit)
    winForfeitAfterDays: 90,
    // Request Timeouts (default: 20 seconds)
    apiRequestTimeoutSec: 20,
    // Employee Authentication (default: 8 hours cache)
    employeeCacheExpiryHours: 8,
    // Offair Trivia (default: 3s lock, 2s tolerance, 4 hours reminder)
    offairTriviaLockExpirySec: 3,
    offairTriviaQuestionTimeToleranceSec: 2,
    offairTriviaReminderSendHours: 4,
    // WebSocket Server Intervals (default: 5s stats, 30s idle, 2s chat)
    wsStatsUpdateIntervalSec: 5,
    wsIdleDisconnectIntervalSec: 30,
    wsChatRelayIntervalSec: 2,
    // Chat Cooldown (default: 2 seconds)
    chatCooldownSec: 2,
    // Background Jobs (default: 7 days avatar refresh, 1 hour check, 6 days min, 24h lock)
    employeeAvatarRefreshIntervalDays: 7,
    forensicsJobCheckIntervalHours: 1,
    forensicsJobMinDaysBetweenRuns: 6,
    forensicsJobLockTTLHours: 24,
    // Game Locks (default: 3 seconds)
    extraLifeLockExpirySec: 3,
    eraserLockExpirySec: 3,
    // Broadcast Stats (default: 4500ms refresh, 30s clear)
    broadcastStatsRefreshIntervalMs: 4500,
    broadcastStatsClearBeforeSec: 30,
    // Command Lock (default: 1 second)
    runCommandLockExpirySec: 1,
    // Broadcast Cache (default: 5 seconds)
    broadcastCacheExpirySec: 5,
    // Droplet Configuration (default: 206315385)
    dropletImage: 206315385
}

async function getGeneralConfig(): Promise<GeneralConfigInstance> {
    const cache = await redis.hGetAll(rKey.generalConfig);
    if (Object.keys(cache).length == 0) {
        // config not cached
        logger.info('updating general config in redis');
        const generalConfig = await GeneralConfig.findOne({ order: [['versionId', 'DESC']] });
        if (generalConfig) {
            const parsed = Object.entries(generalConfig).flatMap(([k, v]) => v != null ? [k, v.toString()] : []);
            await redis.hSet(rKey.generalConfig, parsed);
            return generalConfig;
        } else {
            logger.error('general config missing');
        }
    }
    return {
        makeItRainEnabled: +(cache.makeItRainEnabled ?? generalDefault.makeItRainEnabled),
        makeItRainIntervalSec: +(cache.makeItRainIntervalSec ?? generalDefault.makeItRainIntervalSec),
        payoutsEnabled: +(cache.payoutsEnabled ?? generalDefault.payoutsEnabled),
        payoutThresholdCents: +(cache.payoutThresholdCents ?? generalDefault.payoutThresholdCents),
        // Rate Limiting
        apiRateLimitWindowSec: +(cache.apiRateLimitWindowSec ?? generalDefault.apiRateLimitWindowSec),
        apiRateLimitMaxRequests: +(cache.apiRateLimitMaxRequests ?? generalDefault.apiRateLimitMaxRequests),
        // Verification System
        verificationLockExpirySec: +(cache.verificationLockExpirySec ?? generalDefault.verificationLockExpirySec),
        verificationMaxRetries: +(cache.verificationMaxRetries ?? generalDefault.verificationMaxRetries),
        verificationExpiryMinutes: +(cache.verificationExpiryMinutes ?? generalDefault.verificationExpiryMinutes),
        verificationRetryWaitSec: +(cache.verificationRetryWaitSec ?? generalDefault.verificationRetryWaitSec),
        createAccountLockExpirySec: +(cache.createAccountLockExpirySec ?? generalDefault.createAccountLockExpirySec),
        // Payout/Balance Configuration
        winForfeitAfterDays: +(cache.winForfeitAfterDays ?? generalDefault.winForfeitAfterDays),
        // Request Timeouts
        apiRequestTimeoutSec: +(cache.apiRequestTimeoutSec ?? generalDefault.apiRequestTimeoutSec),
        // Employee Authentication
        employeeCacheExpiryHours: +(cache.employeeCacheExpiryHours ?? generalDefault.employeeCacheExpiryHours),
        // Offair Trivia
        offairTriviaLockExpirySec: +(cache.offairTriviaLockExpirySec ?? generalDefault.offairTriviaLockExpirySec),
        offairTriviaQuestionTimeToleranceSec: +(cache.offairTriviaQuestionTimeToleranceSec ?? generalDefault.offairTriviaQuestionTimeToleranceSec),
        offairTriviaReminderSendHours: +(cache.offairTriviaReminderSendHours ?? generalDefault.offairTriviaReminderSendHours),
        // WebSocket Server Intervals
        wsStatsUpdateIntervalSec: +(cache.wsStatsUpdateIntervalSec ?? generalDefault.wsStatsUpdateIntervalSec),
        wsIdleDisconnectIntervalSec: +(cache.wsIdleDisconnectIntervalSec ?? generalDefault.wsIdleDisconnectIntervalSec),
        wsChatRelayIntervalSec: +(cache.wsChatRelayIntervalSec ?? generalDefault.wsChatRelayIntervalSec),
        // Chat Cooldown
        chatCooldownSec: +(cache.chatCooldownSec ?? generalDefault.chatCooldownSec),
        // Background Jobs
        employeeAvatarRefreshIntervalDays: +(cache.employeeAvatarRefreshIntervalDays ?? generalDefault.employeeAvatarRefreshIntervalDays),
        forensicsJobCheckIntervalHours: +(cache.forensicsJobCheckIntervalHours ?? generalDefault.forensicsJobCheckIntervalHours),
        forensicsJobMinDaysBetweenRuns: +(cache.forensicsJobMinDaysBetweenRuns ?? generalDefault.forensicsJobMinDaysBetweenRuns),
        forensicsJobLockTTLHours: +(cache.forensicsJobLockTTLHours ?? generalDefault.forensicsJobLockTTLHours),
        // Game Locks
        extraLifeLockExpirySec: +(cache.extraLifeLockExpirySec ?? generalDefault.extraLifeLockExpirySec),
        eraserLockExpirySec: +(cache.eraserLockExpirySec ?? generalDefault.eraserLockExpirySec),
        // Broadcast Stats
        broadcastStatsRefreshIntervalMs: +(cache.broadcastStatsRefreshIntervalMs ?? generalDefault.broadcastStatsRefreshIntervalMs),
        broadcastStatsClearBeforeSec: +(cache.broadcastStatsClearBeforeSec ?? generalDefault.broadcastStatsClearBeforeSec),
        // Command Lock
        runCommandLockExpirySec: +(cache.runCommandLockExpirySec ?? generalDefault.runCommandLockExpirySec),
        // Broadcast Cache
        broadcastCacheExpirySec: +(cache.broadcastCacheExpirySec ?? generalDefault.broadcastCacheExpirySec),
        // Droplet Configuration
        dropletImage: +(cache.dropletImage ?? generalDefault.dropletImage)
    }
}

export default getGeneralConfig;

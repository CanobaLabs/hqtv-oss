import { DataTypes, Model } from 'sequelize';
import { configDb } from '../connections';

class GeneralConfig extends Model {
    declare versionId: number;
    declare makeItRainEnabled: number;
    declare makeItRainIntervalSec: number;
    declare payoutsEnabled: number;
    declare payoutThresholdCents: number;
    // Rate Limiting
    declare apiRateLimitWindowSec: number;
    declare apiRateLimitMaxRequests: number;
    // Verification System
    declare verificationLockExpirySec: number;
    declare verificationMaxRetries: number;
    declare verificationExpiryMinutes: number;
    declare verificationRetryWaitSec: number;
    declare createAccountLockExpirySec: number;
    // Payout/Balance Configuration
    declare winForfeitAfterDays: number;
    // Request Timeouts
    declare apiRequestTimeoutSec: number;
    // Employee Authentication
    declare employeeCacheExpiryHours: number;
    // Offair Trivia
    declare offairTriviaLockExpirySec: number;
    declare offairTriviaQuestionTimeToleranceSec: number;
    declare offairTriviaReminderSendHours: number;
    // WebSocket Server Intervals
    declare wsStatsUpdateIntervalSec: number;
    declare wsIdleDisconnectIntervalSec: number;
    declare wsChatRelayIntervalSec: number;
    // Chat Cooldown
    declare chatCooldownSec: number;
    // Background Jobs
    declare employeeAvatarRefreshIntervalDays: number;
    declare forensicsJobCheckIntervalHours: number;
    declare forensicsJobMinDaysBetweenRuns: number;
    declare forensicsJobLockTTLHours: number;
    // Game Locks
    declare extraLifeLockExpirySec: number;
    declare eraserLockExpirySec: number;
    // Broadcast Stats
    declare broadcastStatsRefreshIntervalMs: number;
    declare broadcastStatsClearBeforeSec: number;
    // Command Lock
    declare runCommandLockExpirySec: number;
    // Broadcast Cache
    declare broadcastCacheExpirySec: number;
    // Droplet Configuration
    declare dropletImage: number;
}

GeneralConfig.init({
    versionId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    makeItRainEnabled: {
        type: DataTypes.TINYINT
    },
    makeItRainIntervalSec: {
        type: DataTypes.INTEGER
    },
    payoutsEnabled: {
        type: DataTypes.TINYINT
    },
    payoutThresholdCents: {
        type: DataTypes.INTEGER
    },
    // Rate Limiting
    apiRateLimitWindowSec: {
        type: DataTypes.INTEGER
    },
    apiRateLimitMaxRequests: {
        type: DataTypes.INTEGER
    },
    // Verification System
    verificationLockExpirySec: {
        type: DataTypes.INTEGER
    },
    verificationMaxRetries: {
        type: DataTypes.INTEGER
    },
    verificationExpiryMinutes: {
        type: DataTypes.INTEGER
    },
    verificationRetryWaitSec: {
        type: DataTypes.INTEGER
    },
    createAccountLockExpirySec: {
        type: DataTypes.INTEGER
    },
    // Payout/Balance Configuration
    winForfeitAfterDays: {
        type: DataTypes.INTEGER
    },
    // Request Timeouts
    apiRequestTimeoutSec: {
        type: DataTypes.INTEGER
    },
    // Employee Authentication
    employeeCacheExpiryHours: {
        type: DataTypes.INTEGER
    },
    // Offair Trivia
    offairTriviaLockExpirySec: {
        type: DataTypes.INTEGER
    },
    offairTriviaQuestionTimeToleranceSec: {
        type: DataTypes.INTEGER
    },
    offairTriviaReminderSendHours: {
        type: DataTypes.INTEGER
    },
    // WebSocket Server Intervals
    wsStatsUpdateIntervalSec: {
        type: DataTypes.INTEGER
    },
    wsIdleDisconnectIntervalSec: {
        type: DataTypes.INTEGER
    },
    wsChatRelayIntervalSec: {
        type: DataTypes.INTEGER
    },
    // Chat Cooldown
    chatCooldownSec: {
        type: DataTypes.INTEGER
    },
    // Background Jobs
    employeeAvatarRefreshIntervalDays: {
        type: DataTypes.INTEGER
    },
    forensicsJobCheckIntervalHours: {
        type: DataTypes.INTEGER
    },
    forensicsJobMinDaysBetweenRuns: {
        type: DataTypes.INTEGER
    },
    forensicsJobLockTTLHours: {
        type: DataTypes.INTEGER
    },
    // Game Locks
    extraLifeLockExpirySec: {
        type: DataTypes.INTEGER
    },
    eraserLockExpirySec: {
        type: DataTypes.INTEGER
    },
    // Broadcast Stats
    broadcastStatsRefreshIntervalMs: {
        type: DataTypes.INTEGER
    },
    broadcastStatsClearBeforeSec: {
        type: DataTypes.INTEGER
    },
    // Command Lock
    runCommandLockExpirySec: {
        type: DataTypes.INTEGER
    },
    // Broadcast Cache
    broadcastCacheExpirySec: {
        type: DataTypes.INTEGER
    },
    // Droplet Configuration
    dropletImage: {
        type: DataTypes.INTEGER
    }
}, {
    tableName: 'generalConfig',
    sequelize: configDb,
    freezeTableName: true
});

export default GeneralConfig;

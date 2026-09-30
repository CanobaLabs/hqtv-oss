// Initialize Sentry BEFORE importing Express
import '../common/utils/initSentry';

import cors from 'cors';
import compression from 'compression';
import express, { NextFunction, Request, Response } from 'express';
import http from 'http';
import ms from 'ms';
import { all } from 'better-all';
import { BaseError as SequelizeBaseError } from 'sequelize';
import HqError from '../common/hqError';
import logger from '../common/logger';
import redis from '../common/redisClient';
import ensureAuditTypeColumnsAreVarChar from '../common/database/migrations/ensureAuditTypeColumnsAreVarChar';
import ensureAuditDescriptionIsLongText from '../common/database/migrations/ensureAuditDescriptionIsLongText';
import inflateSeasonBy100x from '../common/database/migrations/inflateSeasonBy100x';
import removePrivateIpsFromLoginTokens from '../common/database/migrations/removePrivateIpsFromLoginTokens';
import removePuzzleAndQuestionResultsFromOutlines from '../common/database/migrations/removePuzzleAndQuestionResultsFromOutlines';
import setStreamBootStatusToDestroyed from '../common/database/migrations/setStreamBootStatusToDestroyed';
import useSentry from '../common/utils/useSentry';
import getOffset from './middleware/getOffset';
import rKey from '../common/redisKeys';
import getGeneralConfig from './utils/getGeneralConfig';
import * as employees from './routeHandlers/employees';
import * as users from './routeHandlers/users';
import { createOutlineCollaborationServer } from './websocket/outlineCollaboration/server';
import * as devops from './routeHandlers/devops';

const api = express()
    .use(compression())
    .use(express.json())
    .use(express.static('../../../public'))
    .use(cors())
    .set('json spaces', 2)
    .disable('x-powered-by')
    .disable('etag');

useSentry(api);

api.use(getOffset);
api.use(async (req, res, next) => {
    const config = await getGeneralConfig();
    res.setTimeout(ms(`${config.apiRequestTimeoutSec} seconds`), () => {
        return next(new HqError('Request took too long. Please try again.', 499, 504));
    });
    return next();
});
api.use((req, res, next) => {
    // Random headers that really benefit nobody (but HQ had them so we have to)
    res.setHeader('x-server-env', process.env?.ENVIRONMENT ?? 'prod');
    let originalHostname = (process.env?.HOSTNAME ?? 'hypeapi-fffffff-local').split('-');
    let newHostname = (originalHostname[0] == 'ws' ? 'hypeapi-websocket-' : 'hypeapi-') + originalHostname[1] + '-' + originalHostname[2];
    res.setHeader('x-hostname', newHostname);
    res.setHeader('x-node-version', process.versions.node);
    res.setHeader('x-hype-version', 'hypeapi-1.0');
    res.setHeader('x-hype-namespace', 'default');
    return next();
});

// add routes
api.use(require('./routes/hqRoutes').default);
api.use(require('./routes/adminPanelRoutes').default);
api.all('*', (req, res, next) => {
    logger.info(`404 URL=${req.url}`);
    throw new HqError('not found', 434, 404);
});

api.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (err instanceof HqError) {
        return res.status(err.statusCode()).json(err);
    }

    if (err instanceof SequelizeBaseError) {
        const sqlParent = (err as unknown as { parent?: Record<string, unknown>; original?: Record<string, unknown>; sql?: string; }).parent
            || (err as unknown as { original?: Record<string, unknown>; sql?: string; }).original
            || null;

        logger.error({
            err,
            sequelize: {
                name: err.name,
                message: err.message,
                sql: (err as unknown as { sql?: string }).sql,
                sqlParent: sqlParent ? {
                    code: sqlParent['code'],
                    errno: sqlParent['errno'],
                    sqlState: sqlParent['sqlState'] ?? sqlParent['state'],
                    sqlMessage: sqlParent['sqlMessage'] ?? sqlParent['message'],
                    sql: sqlParent['sql'],
                } : null,
            },
        }, 'Unhandled Sequelize error');
    } else {
        logger.error({ err }, 'Unhandled error');
    }
    return next(err);
});

const server = http.createServer(api);

// Initialize outline collaboration WebSocket server
createOutlineCollaborationServer(server);

server.listen(process.env.PORT || 8080, async () => {
    logger.info(`api ready @ ${new Date().toISOString()}`);
    if (process.env.ENVIRONMENT == 'prod') redis.set(rKey.bootStatus('api'), 'booted');

    try {
        await ensureAuditTypeColumnsAreVarChar();
        await ensureAuditDescriptionIsLongText();
        await removePrivateIpsFromLoginTokens();
        await removePuzzleAndQuestionResultsFromOutlines();
        await setStreamBootStatusToDestroyed();
        await inflateSeasonBy100x();
    } catch (err) {
        logger.error({ err }, 'Failed to run database migrations');
    }

    // Recover any incomplete stream boot processes
    try {
        logger.info('Checking for incomplete stream boot processes...');
        await devops.recoverIncompleteBootStream();
    } catch (err) {
        logger.error({ err }, 'Failed to recover incomplete boot stream');
    }

    // Check for stuck booting stream
    try {
        logger.info('Checking for stuck booting stream...');
        await devops.checkForStuckBootingStream();
    } catch (err) {
        logger.error({ err }, 'Failed to check for stuck booting stream');
    }

    const config = await getGeneralConfig();
    
    // Refresh all employee avatars on server boot
    try {
        logger.info('Refreshing employee avatars on server boot...');
        const result = await employees.refreshAllEmployeeAvatars();
        logger.info(`Employee avatar refresh completed: ${result.updated}/${result.total} updated, ${result.failed} failed`);
    } catch (err) {
        logger.error({ err }, 'Failed to refresh employee avatars on boot');
    }
    
    // Set up periodic refresh based on config
    setInterval(async () => {
        try {
            const currentConfig = await getGeneralConfig();
            logger.info(`Starting periodic employee avatar refresh (every ${currentConfig.employeeAvatarRefreshIntervalDays} days)...`);
            const result = await employees.refreshAllEmployeeAvatars();
            logger.info(`Periodic employee avatar refresh completed: ${result.updated}/${result.total} updated, ${result.failed} failed`);
        } catch (err) {
            logger.error({ err }, 'Failed to refresh employee avatars periodically');
        }
    }, ms(`${config.employeeAvatarRefreshIntervalDays} days`));

    // Set up forensics analysis on all users (with distributed lock for multi-instance)
    setInterval(async () => {
        try {
            const { currentConfig, isRunning, lastRun } = await all({
                async currentConfig() { return getGeneralConfig(); },
                async isRunning() { return redis.get(rKey.forensicsJobLock); },
                async lastRun() { return redis.get(rKey.forensicsJobLastRun); }
            });
            
            if (isRunning) {
                logger.info('Forensics job already running on another instance, skipping...');
                return;
            }
            if (lastRun) {
                const lastRunTime = parseInt(lastRun, 10);
                const daysSinceLastRun = (Date.now() - lastRunTime) / ms('1 day');
                if (daysSinceLastRun < currentConfig.forensicsJobMinDaysBetweenRuns) {
                    logger.info(`Forensics job ran ${daysSinceLastRun.toFixed(1)} days ago, skipping (minimum ${currentConfig.forensicsJobMinDaysBetweenRuns} days)`);
                    return;
                }
            }

            // Try to acquire lock
            const lockAcquired = await redis.set(rKey.forensicsJobLock, Date.now().toString(), {
                NX: true,
                PX: ms(`${currentConfig.forensicsJobLockTTLHours} hours`)
            });

            if (!lockAcquired) {
                logger.info('Unable to acquire forensics job lock, another instance may be running');
                return;
            }

            logger.info('Acquired lock for forensics analysis, starting...');
            const result = await users.runForensicsOnAllUsers(10, (processed, total, errors) => {
                if (processed % 500 === 0 || processed === total) {
                    logger.info(`Forensics progress: ${processed}/${total} (${errors} errors)`);
                }
            });
            
            await all({
                async setLastRun() {
                    return redis.set(rKey.forensicsJobLastRun, Date.now().toString());
                },
                async delLock() {
                    return redis.del(rKey.forensicsJobLock);
                }
            });
            
            logger.info(`Forensics analysis completed: ${result.processed} successful, ${result.errors} errors, ${result.skipped} skipped out of ${result.total} total users`);
        } catch (err) {
            logger.error({ err }, 'Failed to run forensics analysis');
            // Release lock on error
            try {
                await redis.del(rKey.forensicsJobLock);
            } catch (delErr) {
                logger.error({ err: delErr }, 'Failed to release forensics job lock after error');
            }
        }
    }, ms(`${config.forensicsJobCheckIntervalHours} hours`));

    // Periodic check for stuck booting stream (every 1 minute)
    setInterval(async () => {
        try {
            await devops.checkForStuckBootingStream();
        } catch (err) {
            logger.error({ err }, 'Failed to check for stuck booting stream periodically');
        }
    }, ms('1 minute'));

    // Run forensics on all users on server boot (optional - can be removed if you only want weekly)
    // Uncomment the following block if you want to run forensics on boot:
    /*
    try {
        logger.info('Running forensics analysis on all users on server boot...');
        const result = await users.runForensicsOnAllUsers(10);
        logger.info(`Boot forensics analysis completed: ${result.processed} successful, ${result.errors} errors, ${result.skipped} skipped out of ${result.total} total users`);
    } catch (err) {
        logger.error({ err }, 'Failed to run forensics analysis on boot');
    }
    */
});

process.on('SIGINT', () => {
    if (process.env.ENVIRONMENT == 'prod') redis.set(rKey.bootStatus('api'), 'destroyed');
    process.exit();
});

export default api;

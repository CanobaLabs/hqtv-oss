import ms from 'ms';
import Broadcast from '../../common/database/eventModels/broadcast';
import logger from '../../common/logger';
import redis from '../../common/redisClient';
import rKey from '../../common/redisKeys';
import { destroySocket } from '../../api/routeHandlers/devops';
import HqError from '../../common/hqError';
import sendDiscordPrompter from './sendDiscordPrompter';
import { EmbedBuilder } from 'discord.js';

const INACTIVITY_THRESHOLD_MS = ms('15 minutes');
const CHECK_INTERVAL_MS = ms('1 minute');

let lastLiveGameTimestamp: number | null = null;
let monitoringInterval: NodeJS.Timeout | null = null;
let isDestroying = false;

async function checkForLiveGames(): Promise<boolean> {
    try {
        const activeBroadcast = await Broadcast.findOne({ where: { ended: null } });
        return activeBroadcast !== null;
    } catch (error) {
        logger.error({ error }, 'Error checking for live games');
        return false;
    }
}

async function monitorInactiveSocket() {
    if (isDestroying) {
        return;
    }

    try {
        const bootStatus = await redis.get(rKey.bootStatus('socket'));
        if (bootStatus === 'destroyed') {
            logger.debug('Socket already destroyed, stopping monitoring');
            stopInactiveSocketMonitoring();
            return;
        }

        const hasLiveGame = await checkForLiveGames();

        if (hasLiveGame) {
            lastLiveGameTimestamp = Date.now();
            logger.debug('Live game detected, resetting inactivity timer');
        } else {
            const now = Date.now();
            
            if (lastLiveGameTimestamp === null) {
                lastLiveGameTimestamp = now;
                logger.info('No live games detected, starting inactivity timer');
                return;
            }

            const timeSinceLastLiveGame = now - lastLiveGameTimestamp;

            if (timeSinceLastLiveGame >= INACTIVITY_THRESHOLD_MS) {
                logger.warn({ 
                    timeSinceLastLiveGame: ms(timeSinceLastLiveGame, { long: true }),
                    lastLiveGameTimestamp 
                }, 'No live games for 15 minutes, destroying socket');
                
                isDestroying = true;
                try {
                    const employeeId = process.env.COMMUNICATION_SECRET || 'system';
                    await destroySocket(employeeId, true);
                    logger.info('Socket destroyed due to inactivity');
                    stopInactiveSocketMonitoring();
                } catch (error) {
                    if (error instanceof HqError && error.error.includes('busy')) {
                        logger.info('Socket is busy (being booted or destroyed), will retry on next check');
                    } else {
                        logger.error({ error }, 'Error destroying socket due to inactivity');
                    }
                } finally {
                    isDestroying = false;
                }
            } else {
                const remainingTime = INACTIVITY_THRESHOLD_MS - timeSinceLastLiveGame;
                logger.debug({ 
                    remainingTime: ms(remainingTime, { long: true }),
                    timeSinceLastLiveGame: ms(timeSinceLastLiveGame, { long: true })
                }, 'No live games, but threshold not reached');
            }
        }
    } catch (error) {
        logger.error({ error }, 'Error in monitorInactiveSocket');
    }
}

export function startInactiveSocketMonitoring() {
    if (monitoringInterval) {
        logger.warn('Inactive socket monitoring already started');
        return;
    }

    logger.info('Starting inactive socket monitoring');
    lastLiveGameTimestamp = null;
    
    monitoringInterval = setInterval(() => {
        monitorInactiveSocket().catch((error) => {
            logger.error({ error }, 'Unhandled error in monitorInactiveSocket interval');
        });
    }, CHECK_INTERVAL_MS);

    monitorInactiveSocket().catch((error) => {
        logger.error({ error }, 'Error in initial monitorInactiveSocket call');
    });
}

export function stopInactiveSocketMonitoring() {
    if (monitoringInterval) {
        clearInterval(monitoringInterval);
        monitoringInterval = null;
        logger.info('Stopped inactive socket monitoring');
    }
}

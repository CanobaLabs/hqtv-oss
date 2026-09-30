import { createApiClient } from 'dots-wrapper';
import { IGetAppApiResponse } from 'dots-wrapper/dist/app';
import logger from '../../common/logger';
import redis from '../../common/redisClient';
import Audit from '../../common/database/adminModels/audit';
import axios from 'axios';
import HqError from '../../common/hqError';
import sendDiscordPrompter from '../../websocket/helpers/sendDiscordPrompter';
import { EmbedBuilder } from 'discord.js';
import rKey from '../../common/redisKeys';
import getGeneralConfig from '../utils/getGeneralConfig';
import { getEmployee, calculateEmployeePermissionSets } from './employees';

const dots = createApiClient({token: process.env.DO_TOKEN || ''});

export async function getServers() {
	let apiServer = (await dots.app.getApp({app_id: 'd43087d1-8072-48fa-87d9-80746a8f7ed4'})).data; // API
    let wsServer = (await dots.app.getApp({app_id: 'c949dfc3-64b4-4541-b16b-495993f981cd'})).data; // WS
    let hlsServer = (await dots.app.getApp({app_id: 'ca73c599-293b-4f0e-8b9a-22120cd405eb'})).data; // HLS
    const tentativeServerList = dots.droplet.listDroplets({ per_page: 100 }).then(async (response) => {
        let droplets = response.data.droplets;
        droplets = droplets.filter((droplet) => droplet.name === 'hqtv-stream');
        let tentativeServerList: { name: string; id: number; displayName: string; booted: boolean; serverInfo: null | { instance_size: string, instance_count: Number}}[] = [];
        function addAppProcess(name: string, id: number, displayName: string, app: IGetAppApiResponse)  {
            tentativeServerList.push({
                name,
                id,
                displayName,
                booted: (app.app.spec.services ?? []).length > 0,
                serverInfo: (app.app.spec.services ?? []).length > 0 ? {
                    instance_size: app.app.spec.services![0].instance_size_slug!,
                    instance_count: app.app.spec.services![0].instance_count!
                } : null
            })
        }
        addAppProcess("api", 0, "API", apiServer);
        addAppProcess("socket", 2, "Websocket", wsServer);
        tentativeServerList.push({
            name: "stream",
            id: 1,
            displayName: "Stream",
            booted: droplets.length > 0,
            serverInfo: droplets.length > 0 ? {
                instance_size: "c-8-intel",
                instance_count: 1
            } : null
        });
        if (["booting", "booted"].includes(await redis.get(rKey.bootStatus('stream')) ?? "unknown")) {
            // Add HLS server
            addAppProcess("hls", 3, "HLS Proxy", hlsServer);
        }
        return tentativeServerList;
    });
    return tentativeServerList;
}

export async function getServerStatusAudit(broadcastIdStr: string = '') {
	return await Audit.findAll({
        where: { to: broadcastIdStr, toType: "server" },
        order: [
            ['date', 'DESC'],
        ],
    });
}

export async function getInstanceSizes() {
	let serverResponse = await axios.get('https://api.digitalocean.com/v2/apps/tiers/instance_sizes', {
        headers: {
            'Authorization': `Bearer ${process.env.DO_TOKEN}`
        }
    });
    return serverResponse.data;
}

export async function getBootStatusOfServer(server: string = '') {
	if (!["api", "socket", "stream", "hls"].includes(server)) throw new HqError('Invalid server', 0, 400);
    return await redis.get(rKey.bootStatus(server)) ?? "unknown";
}

export async function setHlsStatusToBooted(authHeader: string = '') {
	if (authHeader != process.env.COMMUNICATION_SECRET) throw new HqError('Bad auth', 0, 403);
    redis.set(rKey.bootStatus('hls'), "booted");
    return {};
}

export async function setStreamStatusToBooted(authHeader: string = '') {
	if (authHeader != process.env.COMMUNICATION_SECRET) throw new HqError('Bad auth', 0, 403);
    redis.set(rKey.bootStatus('stream'), "booted");
    return {};
}

// Helper function to complete IP and firewall assignment (idempotent)
async function completeDropletSetup(dropletId: number): Promise<boolean> {
    logger.info({ dropletId }, '[completeDropletSetup] Starting droplet setup completion');
    
    try {
        // Check if IP is already assigned by checking the droplet's IPs
        const response = await dots.droplet.listDroplets({ per_page: 100 });
        const droplets = response.data.droplets;
        const droplet = droplets.find((d) => d.id === dropletId);
        
        if (!droplet) {
            logger.warn({ dropletId }, '[completeDropletSetup] Droplet not found');
            return false;
        }
        
        // Check if IP is already assigned
        const hasFloatingIp = droplet.networks?.v4?.some((net: any) => net.ip === '164.90.255.81' && net.type === 'public');
        
        if (hasFloatingIp) {
            logger.info({ dropletId }, '[completeDropletSetup] IP already assigned, checking firewall');
        } else {
            // Assign IP
            const ipAssignParams = {
                droplet_id: dropletId,
                ip: '164.90.255.81',
            };
            logger.info({ params: ipAssignParams }, '[completeDropletSetup] Assigning IP to droplet');
            
            try {
                const ipAssignResponse = await dots.floatingIp.assignIpToDroplet(ipAssignParams);
                logger.info({ responseBody: JSON.stringify(ipAssignResponse.data, null, 2) }, '[completeDropletSetup] IP assigned successfully');
            } catch (error: any) {
                // If IP is already assigned, that's fine (idempotent)
                if (error.response?.status === 422 && error.response?.data?.message?.includes('already')) {
                    logger.info({ dropletId }, '[completeDropletSetup] IP already assigned (from error message)');
                } else {
                    logger.error({ error: error.message, errorStack: error.stack, errorResponse: error.response?.data }, '[completeDropletSetup] Error assigning IP');
                    throw error;
                }
            }
        }
        
        // Firewall assignment - try it (DigitalOcean API will handle if already assigned)
        const firewallParams = {
            droplet_ids: [dropletId],
            firewall_id: '7b025ce6-f1fd-43c0-857e-3a74c3e9e94e',
        };
        logger.info({ params: firewallParams }, '[completeDropletSetup] Adding droplet to firewall');
        
        try {
            const firewallResponse = await dots.firewall.addDropletsToFirewall(firewallParams);
            logger.info({ responseBody: JSON.stringify(firewallResponse.data, null, 2) }, '[completeDropletSetup] Firewall rules added successfully');
        } catch (error: any) {
            // If already in firewall, that's fine (idempotent)
            if (error.response?.status === 422 && error.response?.data?.message?.includes('already')) {
                logger.info({ dropletId }, '[completeDropletSetup] Droplet already in firewall');
            } else {
                logger.error({ error: error.message, errorStack: error.stack, errorResponse: error.response?.data }, '[completeDropletSetup] Error adding to firewall');
                throw error;
            }
        }
        
        logger.info({ dropletId }, '[completeDropletSetup] Droplet setup completed successfully');
        return true;
    } catch (error: any) {
        logger.error({ 
            error: error.message, 
            errorStack: error.stack,
            errorResponse: error.response?.data,
            dropletId 
        }, '[completeDropletSetup] Error completing droplet setup');
        return false;
    }
}

// Helper function to poll and complete droplet setup
async function pollDropletStatus(dropletId: number, maxAttempts: number = 60, intervalMs: number = 2000): Promise<void> {
    logger.info({ dropletId, maxAttempts, intervalMs }, '[pollDropletStatus] Starting pollDropletStatus');
    
    // Store state in Redis
    await redis.set(rKey.bootStreamState, JSON.stringify({
        dropletId,
        step: 'polling',
        startedAt: Date.now()
    }));
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        logger.info({ attempt: attempt + 1, maxAttempts, dropletId }, '[pollDropletStatus] Polling droplet status');
        
        try {
            const response = await dots.droplet.listDroplets({ per_page: 100 });
            const droplets = response.data.droplets;
            const droplet = droplets.find((d) => d.id === dropletId);
            
            logger.info({ 
                dropletFound: !!droplet, 
                dropletStatus: droplet?.status,
                dropletId,
                attempt: attempt + 1
            }, '[pollDropletStatus] Droplet lookup result');
            
            if (droplet && droplet.status === 'active') {
                logger.info({ dropletId, dropletStatus: droplet.status }, '[pollDropletStatus] Droplet is active, completing setup');
                
                const success = await completeDropletSetup(dropletId);
                if (success) {
                    // Update state to completed
                    await redis.del(rKey.bootStreamState);
                    await redis.del("lock:stream");
                    logger.info('[pollDropletStatus] Polling completed successfully, lock removed');
                    return;
                } else {
                    logger.warn({ dropletId }, '[pollDropletStatus] Setup completion failed, will retry');
                }
            }
            
            // If not active yet, wait before next poll
            if (attempt < maxAttempts - 1) {
                logger.info({ attempt: attempt + 1, maxAttempts, waitMs: intervalMs }, '[pollDropletStatus] Droplet not active yet, waiting before next poll');
                await new Promise(resolve => setTimeout(resolve, intervalMs));
            }
        } catch (error: any) {
            logger.error({ 
                error: error.message, 
                errorStack: error.stack, 
                errorResponse: error.response?.data,
                attempt: attempt + 1, 
                maxAttempts 
            }, '[pollDropletStatus] Error polling droplet status');
            
            if (attempt < maxAttempts - 1) {
                logger.info({ attempt: attempt + 1, maxAttempts, waitMs: intervalMs }, '[pollDropletStatus] Waiting before retry after error');
                await new Promise(resolve => setTimeout(resolve, intervalMs));
            }
        }
    }
    
    logger.warn({ dropletId, maxAttempts }, '[pollDropletStatus] Polling exhausted all attempts, attempting final setup');
    
    // Final attempt - try to complete setup even if status check failed
    const success = await completeDropletSetup(dropletId);
    if (success) {
        await redis.del(rKey.bootStreamState);
    }
    
    await redis.del("lock:stream");
    logger.info('[pollDropletStatus] Lock removed after polling timeout');
}

// Check for stuck booting state (booting for 2+ minutes with no droplet, or booting with no boot state)
export async function checkForStuckBootingStream(): Promise<void> {
    logger.info('[checkForStuckBootingStream] Checking for stuck booting stream');
    
    try {
        const bootStatus = await redis.get(rKey.bootStatus('stream'));
        if (bootStatus !== 'booting') {
            return;
        }
        
        const bootStateStr = await redis.get(rKey.bootStreamState);
        
        // If booting but no boot state exists, consider it stuck
        if (!bootStateStr) {
            logger.warn('[checkForStuckBootingStream] Stream is booting but no boot state exists, checking for droplet');
            
            const response = await dots.droplet.listDroplets({ per_page: 100 });
            const droplets = response.data.droplets;
            const streamDroplet = droplets.find((d) => d.name === 'hqtv-stream');
            
            if (!streamDroplet) {
                logger.warn('[checkForStuckBootingStream] Stream stuck in booting state with no boot state and no droplet, setting to destroyed');
                await redis.set(rKey.bootStatus('stream'), 'destroyed');
                await redis.set(rKey.bootStatus('hls'), 'destroyed');
                await redis.del("lock:stream");
                logger.info('[checkForStuckBootingStream] Cleared stuck booting state (no boot state)');
            }
            return;
        }
        
        const bootState = JSON.parse(bootStateStr);
        const startedAt = bootState.startedAt;
        
        if (!startedAt) {
            logger.warn('[checkForStuckBootingStream] Boot state exists but missing startedAt timestamp, checking for droplet');
            
            const response = await dots.droplet.listDroplets({ per_page: 100 });
            const droplets = response.data.droplets;
            const streamDroplet = droplets.find((d) => d.name === 'hqtv-stream');
            
            if (!streamDroplet) {
                logger.warn('[checkForStuckBootingStream] Stream stuck in booting state with invalid boot state and no droplet, setting to destroyed');
                await redis.set(rKey.bootStatus('stream'), 'destroyed');
                await redis.set(rKey.bootStatus('hls'), 'destroyed');
                await redis.del(rKey.bootStreamState);
                await redis.del("lock:stream");
                logger.info('[checkForStuckBootingStream] Cleared stuck booting state (invalid boot state)');
            }
            return;
        }
        
        const timeSinceStart = Date.now() - startedAt;
        const twoMinutesMs = 2 * 60 * 1000;
        
        if (timeSinceStart < twoMinutesMs) {
            return;
        }
        
        logger.info({ timeSinceStart, startedAt }, '[checkForStuckBootingStream] Stream has been booting for more than 2 minutes, checking for droplet');
        
        const response = await dots.droplet.listDroplets({ per_page: 100 });
        const droplets = response.data.droplets;
        const streamDroplet = droplets.find((d) => d.name === 'hqtv-stream');
        
        if (!streamDroplet) {
            logger.warn({ timeSinceStart }, '[checkForStuckBootingStream] Stream stuck in booting state for 2+ minutes with no droplet, setting to destroyed');
            await redis.set(rKey.bootStatus('stream'), 'destroyed');
            await redis.set(rKey.bootStatus('hls'), 'destroyed');
            await redis.del(rKey.bootStreamState);
            await redis.del("lock:stream");
            logger.info('[checkForStuckBootingStream] Cleared stuck booting state');
        }
    } catch (error: any) {
        logger.error({ 
            error: error.message, 
            errorStack: error.stack 
        }, '[checkForStuckBootingStream] Error checking for stuck booting stream');
    }
}

// Recovery function to resume incomplete boot processes
export async function recoverIncompleteBootStream(): Promise<void> {
    logger.info('[recoverIncompleteBootStream] Checking for incomplete boot processes');
    
    try {
        const bootStateStr = await redis.get(rKey.bootStreamState);
        if (!bootStateStr) {
            logger.info('[recoverIncompleteBootStream] No incomplete boot state found');
            return;
        }
        
        const bootState = JSON.parse(bootStateStr);
        logger.info({ bootState }, '[recoverIncompleteBootStream] Found incomplete boot state');
        
        // Check if lock exists (if not, something else might be happening)
        const lockExists = await redis.exists("lock:stream");
        if (!lockExists) {
            logger.warn('[recoverIncompleteBootStream] Boot state exists but lock is missing, clearing state');
            await redis.del(rKey.bootStreamState);
            return;
        }
        
        // Check boot status
        const bootStatus = await redis.get(rKey.bootStatus('stream'));
        if (bootStatus !== 'booting') {
            logger.info({ bootStatus }, '[recoverIncompleteBootStream] Boot status is not "booting", clearing state');
            await redis.del(rKey.bootStreamState);
            await redis.del("lock:stream");
            return;
        }
        
        // Verify droplet still exists
        const response = await dots.droplet.listDroplets({ per_page: 100 });
        const droplets = response.data.droplets;
        const droplet = droplets.find((d) => d.id === bootState.dropletId && d.name === 'hqtv-stream');
        
        if (!droplet) {
            logger.warn({ dropletId: bootState.dropletId }, '[recoverIncompleteBootStream] Droplet not found, clearing state');
            await redis.del(rKey.bootStreamState);
            await redis.del("lock:stream");
            await redis.set(rKey.bootStatus('stream'), 'unknown');
            await redis.set(rKey.bootStatus('hls'), 'unknown');
            return;
        }
        
        logger.info({ dropletId: bootState.dropletId, dropletStatus: droplet.status }, '[recoverIncompleteBootStream] Found droplet, checking if setup is already complete');
        
        // Check if setup is already complete (droplet is active and has IP assigned)
        if (droplet.status === 'active') {
            const hasFloatingIp = droplet.networks?.v4?.some((net: any) => net.ip === '164.90.255.81' && net.type === 'public');
            if (hasFloatingIp) {
                logger.info({ dropletId: bootState.dropletId }, '[recoverIncompleteBootStream] Setup appears to be complete, verifying and cleaning up');
                // Try to complete setup (idempotent - will check if already done)
                const success = await completeDropletSetup(bootState.dropletId);
                if (success) {
                    logger.info({ dropletId: bootState.dropletId }, '[recoverIncompleteBootStream] Setup verified complete, cleaning up state');
                    await redis.del(rKey.bootStreamState);
                    await redis.del("lock:stream");
                    return;
                }
            }
        }
        
        logger.info({ dropletId: bootState.dropletId, dropletStatus: droplet.status }, '[recoverIncompleteBootStream] Resuming boot process');
        
        // Resume polling
        pollDropletStatus(bootState.dropletId).catch((error) => {
            logger.error({ 
                error: error.message, 
                errorStack: error.stack,
                errorResponse: error.response?.data 
            }, '[recoverIncompleteBootStream] Error resuming droplet status polling');
            // Ensure lock is released even on error
            redis.del("lock:stream").catch((delError) => {
                logger.error({ error: delError.message, errorStack: delError.stack }, '[recoverIncompleteBootStream] Error removing lock after polling error');
            });
            redis.del(rKey.bootStreamState).catch(() => {});
        });
    } catch (error: any) {
        logger.error({ 
            error: error.message, 
            errorStack: error.stack 
        }, '[recoverIncompleteBootStream] Error recovering incomplete boot');
        // Try to clean up on error
        try {
            await redis.del(rKey.bootStreamState);
            await redis.del("lock:stream");
        } catch (cleanupError) {
            logger.error({ error: cleanupError }, '[recoverIncompleteBootStream] Error during cleanup');
        }
    }
}

export async function bootStreamServer(employeeId: string = '?') {
    const startTime = Date.now();
    logger.info({ employeeId, startTime }, '[bootStreamServer] Starting stream server boot process');
    
    // Check if lock already exists
    const existingLock = await redis.exists("lock:stream");
    logger.info({ existingLock: existingLock === 1 }, '[bootStreamServer] Checking for existing lock:stream');
    if (existingLock) {
        logger.warn('[bootStreamServer] Lock already exists, but proceeding (lock will be overwritten)');
    }
    
    logger.info('[bootStreamServer] Setting lock:stream in Redis');
    const lockSetResult = await redis.set("lock:stream", "1");
    logger.info({ lockSetResult }, '[bootStreamServer] Lock set result');
    
    // Verify lock was set
    const lockVerify = await redis.exists("lock:stream");
    logger.info({ lockVerify: lockVerify === 1 }, '[bootStreamServer] Verified lock exists after setting');
    
    // Check current boot status before proceeding
    const currentBootStatus = await redis.get(rKey.bootStatus('stream'));
    logger.info({ currentBootStatus }, '[bootStreamServer] Current stream boot status before boot');
    
    // Check current boot state
    const currentBootState = await redis.get(rKey.bootStreamState);
    logger.info({ currentBootState }, '[bootStreamServer] Current boot stream state before boot');
    
    logger.info('[bootStreamServer] Calling dots.droplet.listDroplets to check for existing droplets');
    const listDropletsStartTime = Date.now();
    dots.droplet.listDroplets({ per_page: 100 }).then(async (response) => {
        const listDropletsDuration = Date.now() - listDropletsStartTime;
        logger.info({ 
            duration: listDropletsDuration,
            responseDataKeys: Object.keys(response.data || {}),
            dropletsArrayLength: response.data?.droplets?.length 
        }, '[bootStreamServer] listDroplets response received');
        
        logger.info({ responseBody: JSON.stringify(response.data, null, 2) }, '[bootStreamServer] listDroplets full response body');
        
        let droplets = response.data.droplets;
        logger.info({ 
            dropletCount: droplets.length,
            dropletIds: droplets.map(d => d.id),
            dropletNames: droplets.map(d => d.name),
            dropletStatuses: droplets.map(d => d.status)
        }, '[bootStreamServer] Total droplets found');
        
        const filterStartTime = Date.now();
        droplets = droplets.filter((droplet) => droplet.name === 'hqtv-stream');
        const filterDuration = Date.now() - filterStartTime;
        logger.info({ 
            filteredDropletCount: droplets.length,
            filterDuration,
            filteredDroplets: droplets.map(d => ({ 
                id: d.id, 
                name: d.name, 
                status: d.status,
                region: typeof d.region === 'object' ? d.region?.slug : d.region,
                created: d.created_at
            }))
        }, '[bootStreamServer] Filtered droplets by name "hqtv-stream"');
        
        if (droplets.length > 0) {
            logger.error({ 
                droplets: droplets.map(d => ({ 
                    id: d.id, 
                    name: d.name, 
                    status: d.status,
                    region: typeof d.region === 'object' ? d.region?.slug : d.region,
                    created: d.created_at,
                    networks: d.networks
                }))
            }, '[bootStreamServer] Stream is already booted, throwing error');
            await redis.del("lock:stream");
            throw new HqError('Stream is already booted', 0, 400);
        }
        
        logger.info('[bootStreamServer] No existing stream droplets found, proceeding with boot');
        
        // Set boot status
        const setBootStatusStartTime = Date.now();
        logger.info('[bootStreamServer] Setting boot status to "booting" in Redis');
        const streamStatusSet = await redis.set(rKey.bootStatus('stream'), "booting");
        const hlsStatusSet = await redis.set(rKey.bootStatus('hls'), "booting");
        const setBootStatusDuration = Date.now() - setBootStatusStartTime;
        logger.info({ 
            streamStatusSet,
            hlsStatusSet,
            setBootStatusDuration
        }, '[bootStreamServer] Boot status set to "booting"');
        
        // Verify boot status was set
        const verifyStreamStatus = await redis.get(rKey.bootStatus('stream'));
        const verifyHlsStatus = await redis.get(rKey.bootStatus('hls'));
        logger.info({ 
            verifyStreamStatus,
            verifyHlsStatus
        }, '[bootStreamServer] Verified boot status after setting');
        
        // Store initial boot state
        const initialBootState = {
            step: 'creating_droplet',
            employeeId,
            startedAt: Date.now()
        };
        logger.info({ initialBootState }, '[bootStreamServer] Creating initial boot state');
        const bootStateSet = await redis.set(rKey.bootStreamState, JSON.stringify(initialBootState));
        logger.info({ bootStateSet }, '[bootStreamServer] Initial boot state set');
        
        // Verify boot state was set
        const verifyBootState = await redis.get(rKey.bootStreamState);
        logger.info({ verifyBootState }, '[bootStreamServer] Verified boot state after setting');
        
        // Fetch general config
        logger.info('[bootStreamServer] Fetching general config');
        const configStartTime = Date.now();
        const config = await getGeneralConfig();
        const configDuration = Date.now() - configStartTime;
        logger.info({ 
            dropletImage: config.dropletImage,
            configDuration,
            configKeys: Object.keys(config)
        }, '[bootStreamServer] General config retrieved');
        
        const dropletCreateParams = {
            name: "hqtv-stream",
            region: "nyc1",
            size: "s-8vcpu-32gb-640gb-intel",
            image: config.dropletImage,
        };
        logger.info({ 
            params: dropletCreateParams,
            paramsStringified: JSON.stringify(dropletCreateParams, null, 2)
        }, '[bootStreamServer] Prepared droplet creation parameters');
        
        let dropletCreation: { droplet?: { id?: number; name?: string; status?: string; region?: string | { slug?: string }; created_at?: string } } | undefined;
        const createDropletStartTime = Date.now();
        try {
            logger.info('[bootStreamServer] Calling dots.droplet.createDroplet');
            dropletCreation = (await dots.droplet.createDroplet(dropletCreateParams)).data;
            const createDropletDuration = Date.now() - createDropletStartTime;
            logger.info({ 
                duration: createDropletDuration,
                responseDataKeys: Object.keys(dropletCreation || {}),
                dropletId: dropletCreation.droplet?.id,
                dropletName: dropletCreation.droplet?.name,
                dropletStatus: dropletCreation.droplet?.status,
                dropletRegion: typeof dropletCreation.droplet?.region === 'object' ? dropletCreation.droplet?.region?.slug : dropletCreation.droplet?.region,
                dropletCreated: dropletCreation.droplet?.created_at
            }, '[bootStreamServer] createDroplet response received');
            
            logger.info({ responseBody: JSON.stringify(dropletCreation, null, 2) }, '[bootStreamServer] createDroplet full response body');
            
            if (!dropletCreation.droplet?.id) {
                logger.error({ dropletCreation }, '[bootStreamServer] Droplet creation response missing droplet ID');
                throw new Error('Droplet creation response missing droplet ID');
            }
            
            logger.info({ 
                dropletId: dropletCreation.droplet.id,
                dropletName: dropletCreation.droplet.name,
                dropletStatus: dropletCreation.droplet.status
            }, '[bootStreamServer] Droplet created successfully');
            
            // Update state with droplet ID
            const updatedBootState = {
                dropletId: dropletCreation.droplet.id,
                step: 'updating_app',
                employeeId,
                startedAt: Date.now()
            };
            logger.info({ updatedBootState }, '[bootStreamServer] Updating boot state with droplet ID');
            const bootStateUpdateResult = await redis.set(rKey.bootStreamState, JSON.stringify(updatedBootState));
            logger.info({ bootStateUpdateResult }, '[bootStreamServer] Boot state updated with droplet ID');
            
            // Verify updated boot state
            const verifyUpdatedBootState = await redis.get(rKey.bootStreamState);
            logger.info({ verifyUpdatedBootState }, '[bootStreamServer] Verified updated boot state');
        } catch (error: any) {
            const createDropletDuration = Date.now() - createDropletStartTime;
            const errorDetails = {
                error: error.message,
                errorStack: error.stack,
                statusCode: error.response?.status,
                statusText: error.response?.statusText,
                errorResponse: error.response?.data,
                requestParams: dropletCreateParams,
                dropletImage: config.dropletImage,
                duration: createDropletDuration,
                errorName: error.name,
                errorCode: error.code
            };
            logger.error(errorDetails, '[bootStreamServer] Error creating droplet');
            
            // Clean up state on error
            logger.info('[bootStreamServer] Cleaning up state after droplet creation error');
            const delBootStateResult = await redis.del(rKey.bootStreamState);
            const delLockResult = await redis.del("lock:stream");
            await redis.set(rKey.bootStatus('stream'), 'destroyed');
            await redis.set(rKey.bootStatus('hls'), 'destroyed');
            logger.info({ delBootStateResult, delLockResult }, '[bootStreamServer] Cleanup completed after droplet creation error');
            
            // If it's a 422, provide a more helpful error message
            if (error.response?.status === 422) {
                const doError = error.response?.data;
                const errorMessage = doError?.message || doError?.error || 'Invalid request parameters';
                logger.error({ 
                    errorMessage,
                    doError,
                    dropletImage: config.dropletImage
                }, '[bootStreamServer] 422 error from DigitalOcean API');
                throw new HqError(`Failed to create droplet: ${errorMessage}. Image ID: ${config.dropletImage}`, 0, 422);
            }
            
            throw error;
        }

        const appUpdateParams = {
            spec:  {
                "name": "hls",
                "services": [
                    {
                        "name": "hls",
                        "github": {
                            "repo": "CanobalLabs/hlsproxy",
                            "branch": "main",
                            "deploy_on_push": true
                        },
                        "run_command": "npm run start",
                        "source_dir": "/",
                        "environment_slug": "node-js",
                        "instance_size_slug": "apps-s-1vcpu-0.5gb",
                        "instance_count": 1,
                        "http_port": 8080
                    }
                ],
                "domains": [
                    {
                        "domain": "hls.canobal.com",
                        "type": "PRIMARY"
                    }
                ],
                "region": "nyc",
                "envs": [
                    {
                        "key": "ENVIRONMENT",
                        "value": "prod",
                        "scope": "RUN_AND_BUILD_TIME"
                    },
                    {
                        "key": "COMMUNICATION_SECRET",
                        "value": process.env.COMMUNICATION_SECRET,
                        "scope": "RUN_AND_BUILD_TIME"
                    }
                ]
            },
            app_id: "ca73c599-293b-4f0e-8b9a-22120cd405eb"
        };
        logger.info({ 
            params: JSON.stringify(appUpdateParams, null, 2),
            appId: appUpdateParams.app_id,
            serviceName: appUpdateParams.spec.services[0].name,
            repo: appUpdateParams.spec.services[0].github.repo,
            branch: appUpdateParams.spec.services[0].github.branch
        }, '[bootStreamServer] Prepared app update parameters');
        
        const updateAppStartTime = Date.now();
        try {
            logger.info('[bootStreamServer] Calling dots.app.updateApp');
            const appUpdateResponse = await dots.app.updateApp(appUpdateParams);
            const updateAppDuration = Date.now() - updateAppStartTime;
            logger.info({ 
                duration: updateAppDuration,
                responseDataKeys: Object.keys(appUpdateResponse.data || {}),
                appId: appUpdateResponse.data?.app?.id,
                appName: appUpdateResponse.data?.app?.spec?.name
            }, '[bootStreamServer] updateApp response received');
            
            logger.info({ responseBody: JSON.stringify(appUpdateResponse.data, null, 2) }, '[bootStreamServer] updateApp full response body');
            logger.info('[bootStreamServer] App update completed successfully');
        } catch (error: any) {
            const updateAppDuration = Date.now() - updateAppStartTime;
            logger.error({ 
                error: error.message,
                errorStack: error.stack,
                errorResponse: error.response?.data,
                statusCode: error.response?.status,
                statusText: error.response?.statusText,
                duration: updateAppDuration,
                errorName: error.name,
                errorCode: error.code
            }, '[bootStreamServer] Error updating app');
            
            logger.info('[bootStreamServer] Cleaning up state after app update error');
            const delBootStateResult = await redis.del(rKey.bootStreamState);
            const delLockResult = await redis.del("lock:stream");
            logger.info({ delBootStateResult, delLockResult }, '[bootStreamServer] Cleanup completed after app update error');
            throw error;
        }
        
        // Start polling in the background (don't await, let it run asynchronously)
        if (!dropletCreation?.droplet?.id) {
            logger.error({ dropletCreation }, '[bootStreamServer] Cannot start polling: dropletCreation or droplet ID is missing');
            throw new Error('Droplet creation response missing droplet ID');
        }
        
        logger.info({ 
            dropletId: dropletCreation.droplet.id,
            dropletName: dropletCreation.droplet.name
        }, '[bootStreamServer] Starting background polling for droplet status');
        
        const pollingStartTime = Date.now();
        pollDropletStatus(dropletCreation.droplet.id).catch((error) => {
            const pollingDuration = Date.now() - pollingStartTime;
            logger.error({ 
                error: error.message,
                errorStack: error.stack,
                errorResponse: error.response?.data,
                dropletId: dropletCreation?.droplet?.id,
                duration: pollingDuration,
                errorName: error.name,
                errorCode: error.code
            }, '[bootStreamServer] Error in droplet status polling');
            
            // Ensure lock is released even on error
            logger.info('[bootStreamServer] Cleaning up after polling error');
            redis.del("lock:stream").then((delResult) => {
                logger.info({ delResult }, '[bootStreamServer] Lock removed after polling error');
            }).catch((delError) => {
                logger.error({ 
                    error: delError.message, 
                    errorStack: delError.stack 
                }, '[bootStreamServer] Error removing lock after polling error');
            });
            redis.del(rKey.bootStreamState).then((delResult) => {
                logger.info({ delResult }, '[bootStreamServer] Boot state removed after polling error');
            }).catch(() => {
                logger.error('[bootStreamServer] Error removing boot state after polling error');
            });
        });

        // Send Discord notification
        logger.info({ employeeId }, '[bootStreamServer] Preparing Discord notification');
        const discordStartTime = Date.now();
        try {
            sendDiscordPrompter([
                new EmbedBuilder()
                    .setTitle('Stream booted')
                    .setDescription(`Booted by <@` + employeeId + `>`)
                    .setColor(0x57f287) // Discord success green for starting/booting
            ]);
            const discordDuration = Date.now() - discordStartTime;
            logger.info({ discordDuration }, '[bootStreamServer] Discord notification sent');
        } catch (discordError: any) {
            logger.error({ 
                error: discordError.message,
                errorStack: discordError.stack
            }, '[bootStreamServer] Error sending Discord notification (non-fatal)');
        }
        
        // Create audit log
        logger.info({ employeeId }, '[bootStreamServer] Creating audit log');
        const auditStartTime = Date.now();
        try {
            const auditResult = await Audit.create({
                to: "1",
                toType: 'server',
                from: employeeId,
                fromType: 'employee',
                action: 'boot',
                description: 'Booted stream'
            });
            const auditDuration = Date.now() - auditStartTime;
            logger.info({ 
                auditId: auditResult.id,
                auditDuration
            }, '[bootStreamServer] Audit log created');
        } catch (auditError: any) {
            logger.error({ 
                error: auditError.message,
                errorStack: auditError.stack
            }, '[bootStreamServer] Error creating audit log (non-fatal)');
        }
        
        const totalDuration = Date.now() - startTime;
        logger.info({ 
            dropletId: dropletCreation.droplet?.id,
            totalDuration,
            employeeId
        }, '[bootStreamServer] Boot process completed, returning droplet creation result');
        return dropletCreation;
    }).catch((error) => {
        const totalDuration = Date.now() - startTime;
        logger.error({ 
            error: error.message,
            errorStack: error.stack,
            errorResponse: error.response?.data,
            employeeId,
            totalDuration,
            errorName: error.name,
            errorCode: error.code,
            statusCode: error.response?.status
        }, '[bootStreamServer] Error in bootStreamServer promise chain');
        
        // Clean up state on error
        logger.info('[bootStreamServer] Cleaning up state after promise chain error');
        redis.del(rKey.bootStreamState).then((delResult) => {
            logger.info({ delResult }, '[bootStreamServer] Boot state removed after promise chain error');
        }).catch((delError) => {
            logger.error({ error: delError }, '[bootStreamServer] Error removing boot state after promise chain error');
        });
        redis.del("lock:stream").then((delResult) => {
            logger.info({ delResult }, '[bootStreamServer] Lock removed after promise chain error');
        }).catch((delError) => {
            logger.error({ error: delError }, '[bootStreamServer] Error removing lock after promise chain error');
        });
        throw error;
    });
}

export async function destroyStream(employeeId: string = '?', destroyInactive: boolean = false) {
	if (await redis.exists("lock:stream")) throw new HqError('Stream is busy (being booted or destroyed)', 0, 400);
    if (destroyInactive && employeeId != process.env.COMMUNICATION_SECRET) throw new HqError('Bad auth', 0, 403);

    await redis.set("lock:stream", "1");
    dots.droplet.listDroplets({ per_page: 100 }).then(async (response) => {
        let droplets = response.data.droplets;
        droplets = droplets.filter((droplet) => droplet.name === 'hqtv-stream');
        if (droplets.length === 0) throw new HqError('Stream does not exist', 0, 400);
        
        // Reassign reserved IP to our proxy server, this is only to avoid a $5/mo unassigned reserved IP charge.
        // await dots.floatingIp.assignIpToDroplet({
        //     droplet_id: 394109173,
        //     ip: '45.55.125.108',
        // });

        await dots.app.updateApp({
            spec: {
                "name": "hls",
                "domains": [
                    {
                        "domain": "hls.canobal.com",
                        "type": "PRIMARY"
                    }
                ],
                "region": "nyc"
            },
            app_id: "ca73c599-293b-4f0e-8b9a-22120cd405eb"
        });

        await dots.droplet.deleteDroplet({ droplet_id: droplets[0].id });

        sendDiscordPrompter([
            new EmbedBuilder()
                .setTitle('Stream destroyed')
                .setDescription(destroyInactive ? 'Destroyed automatically due to inactivity' : `Destroyed by <@` + employeeId + `>`)
                .setColor(0xed4245) // Discord error red for destructive actions
        ]);
        await Audit.create({
            to: "1",
            toType: 'server',
            from: employeeId,
            fromType: 'employee',
            action: 'destroy',
            description: 'Destroyed stream'
        });
        await redis.del("lock:stream");
        await redis.set(rKey.bootStatus('stream'), "destroyed");
        await redis.set(rKey.bootStatus('hls'), "destroyed");
        return { message: 'Stream destroyed' };
    });
}

export async function authenticateStream(streamKey: string, authHeader: string = ''): Promise<{ username: string }> {
	if (authHeader != process.env.COMMUNICATION_SECRET) throw new HqError('Bad auth', 0, 403);
	if (!streamKey || typeof streamKey !== 'string') {
		throw new HqError('Unauthorized', 0, 401);
	}

	const employeeIds = await redis.sMembers(rKey.employeeIds);
	if (!employeeIds.length) {
		throw new HqError('Unauthorized', 0, 401);
	}

	const pipeline = redis.multi();
	for (const employeeId of employeeIds) {
		pipeline.hGet(rKey.employee(employeeId), 'streamKey');
	}
	const results = await pipeline.exec();

	let matchingEmployeeId: string | null = null;
	if (results) {
		for (let i = 0; i < results.length; i++) {
			const result = results[i];
			let streamKeyUser: string | null;
			if (typeof result === 'string') {
				streamKeyUser = result;
			} else if (Buffer.isBuffer(result)) {
				streamKeyUser = result.toString();
			} else {
				streamKeyUser = null;
			}
			if (streamKey === streamKeyUser) {
				matchingEmployeeId = employeeIds[i];
				break;
			}
		}
	}

	if (!matchingEmployeeId) {
		throw new HqError('Unauthorized', 0, 401);
	}

	const employee = await getEmployee(matchingEmployeeId);
	const permissions = await calculateEmployeePermissionSets(matchingEmployeeId);

	if (!permissions.combined.includes('stream')) {
		throw new HqError('Unauthorized', 0, 401);
	}

	return {
		username: matchingEmployeeId
	};
}

export async function changeStreamState(username: string = '?', state: 'started' | 'ended', authHeader: string = '') {
    if (authHeader != process.env.COMMUNICATION_SECRET) throw new HqError('Bad auth', 0, 403);
    if (!username) {
        username = '974437528469897216';
    }
    
    const title = state === 'started' ? 'Stream is live' : 'Stream ended';
    const description = state === 'started' 
        ? `<@${username}> started streaming`
        : `<@${username}> ended streaming`;
    
    sendDiscordPrompter([
        new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setColor(state === 'started' ? 0x57f287 : 0xfaa61a) // Discord success green for started, muted orange for ended
    ]);
    await Audit.create({
        to: "1",
        toType: 'server',
        from: username,
        fromType: 'employee',
        action: state === 'started' ? 'stream_started' : 'stream_ended',
        description: state === 'started' ? 'Started streaming' : 'Stopped streaming'
    });
    return;
}

export async function bootSocket(employeeId: string = '') {
	if (await redis.exists("lock:socket")) throw new HqError('Socket is busy (being booted or destroyed)', 0, 400);
    await redis.set("lock:socket", "1");
    await redis.set(rKey.bootStatus('socket'), "booting");
    const currentApp = (await dots.app.getApp({ app_id: "c949dfc3-64b4-4541-b16b-495993f981cd" })).data
    const updatedApp = (await dots.app.updateApp({
        spec:  {
			"name": "ws",
			"services": [
				{
					"name": "ws",
					"github": {
						"repo": "CanobalLabs/hqtv",
						"branch": "main",
						"deploy_on_push": true
					},
					"build_command": "npm run build",
					"run_command": "npm run startws",
					"source_dir": "/",
					"environment_slug": "node-js",
					"instance_size_slug": "apps-s-1vcpu-0.5gb",
					"instance_count": 1,
					"http_port": 8080
				}
			],
			"domains": [
				{
					"domain": "socket.canobal.com",
					"type": "PRIMARY"
				}
			],
			"region": "nyc",
			"envs": currentApp.app.spec.envs
		},
        app_id: "c949dfc3-64b4-4541-b16b-495993f981cd"
    })).data;

    sendDiscordPrompter([
        new EmbedBuilder()
            .setTitle('Socket booted')
            .setDescription(`Booted by <@` + employeeId + `>`)
            .setColor(0x57f287) // Discord success green for starting/booting
    ]);
    await Audit.create({
        to: "2",
        toType: 'server',
        from: employeeId,
        fromType: 'employee',
        action: 'boot',
        description: 'Booted socket'
    });
    await redis.del("lock:socket");
    return updatedApp;
}

export async function destroySocket(employeeId: string = '', destroyInactive: boolean = false) {
	if (await redis.exists("lock:socket")) throw new HqError('Socket is busy (being booted or destroyed)', 0, 400);;
    await redis.set("lock:socket", "1");
    const currentApp = (await dots.app.getApp({ app_id: "c949dfc3-64b4-4541-b16b-495993f981cd" })).data
    const updatedApp = (await dots.app.updateApp({
        spec: {
			"name": "ws",
			"domains": [
				{
					"domain": "socket.canobal.com",
					"type": "PRIMARY"
				}
			],
			"region": "nyc",
			"envs": currentApp.app.spec.envs
		},
        app_id: "c949dfc3-64b4-4541-b16b-495993f981cd"
    })).data;

    const description = destroyInactive ? 'Destroyed automatically due to inactivity' : `Destroyed by <@` + employeeId + `>`;
    sendDiscordPrompter([
        new EmbedBuilder()
            .setTitle('Socket destroyed')
            .setDescription(description)
            .setColor(0xed4245) // Discord error red for destructive actions
    ]);
    await Audit.create({
        to: "2",
        toType: 'server',
        from: employeeId,
        fromType: 'employee',
        action: 'destroy',
        description: 'Destroyed socket'
    });
    await redis.del("lock:socket");
    await redis.set(rKey.bootStatus('socket'), "destroyed");
    return updatedApp;
}

export async function scaleHlsStream(instanceCount: number, instanceSize: string, employeeId: string = '') {
	let currentApp = (await dots.app.getApp({ app_id: "ca73c599-293b-4f0e-8b9a-22120cd405eb" })).data;
    if (currentApp?.app?.spec?.services?.[0]) {
        currentApp.app.spec.services[0].instance_size_slug = instanceSize;
        currentApp.app.spec.services[0].instance_count = instanceCount;
    }
	(await dots.app.updateApp({
		spec:  {
			"name": "hls",
			"services": currentApp?.app?.spec?.services,
			"domains": [
				{
					"domain": "hls.canobal.com",
					"type": "PRIMARY"
				}
			],
			"region": "nyc",
			"envs": [
				{
					"key": "ENVIRONMENT",
					"value": "prod",
					"scope": "RUN_AND_BUILD_TIME"
				},
				{
					"key": "COMMUNICATION_SECRET",
					"value": process.env.COMMUNICATION_SECRET,
					"scope": "RUN_AND_BUILD_TIME"
				}
			]
		},
		app_id: "ca73c599-293b-4f0e-8b9a-22120cd405eb"
	})).data;
	
	sendDiscordPrompter([
        new EmbedBuilder()
            .setTitle(`HLS Proxy scaled to ${instanceCount}x \`${instanceSize}\``)
            .setDescription(`Scaled by <@` + employeeId + `>`)
            .setColor(0x5865f2) // Discord blurple for scaling/informational actions
    ]);
    await Audit.create({
        to: "3",
        toType: 'server',
        from: employeeId,
        fromType: 'employee',
        action: 'scale',
        description: `Scaled HLS Proxy to ${instanceCount}x \`${instanceSize}\``
    });
    return {};
}

export async function scaleApi(instanceCount: number, instanceSize: string, employeeId: string = '') {
	let currentApp = (await dots.app.getApp({ app_id: "d43087d1-8072-48fa-87d9-80746a8f7ed4" })).data;
    if (currentApp?.app?.spec?.services?.[0]) {
        currentApp.app.spec.services[0].instance_size_slug = instanceSize;
        currentApp.app.spec.services[0].instance_count = instanceCount;
    }
	(await dots.app.updateApp({
		spec:  {
			"name": "api",
			"services": currentApp.app.spec.services,
			"domains": [
				{
					"domain": "play.question.house",
					"type": "PRIMARY"
				},
				{
					"domain": "staging.question.house",
					"type": "ALIAS"
				}
			],
			"region": "nyc",
			"envs": currentApp.app.spec.envs
		},
		app_id: "d43087d1-8072-48fa-87d9-80746a8f7ed4"
	})).data;
    sendDiscordPrompter([
        new EmbedBuilder()
            .setTitle(`API scaled to ${instanceCount}x \`${instanceSize}\``)
            .setDescription(`Scaled by <@` + employeeId + `>`)
            .setColor(0x5865f2) // Discord blurple for scaling/informational actions
    ]);
    await Audit.create({
        to: "0",
        toType: 'server',
        from: employeeId,
        fromType: 'employee',
        action: 'scale',
        description: `Scaled API to ${instanceCount}x \`${instanceSize}\``
    });
    return {};
}

export async function scaleSocket(instanceCount: number, instanceSize: string, employeeId: string = '') {
	let currentApp = (await dots.app.getApp({ app_id: "c949dfc3-64b4-4541-b16b-495993f981cd" })).data;
    if (currentApp?.app?.spec?.services?.[0]) {
        currentApp.app.spec.services[0].instance_size_slug = instanceSize;
        currentApp.app.spec.services[0].instance_count = instanceCount;
    }
	
    (await dots.app.updateApp({
        spec:  {
			"name": "ws",
			"services": currentApp.app.spec.services,
			"domains": [
				{
					"domain": "socket.canobal.com",
					"type": "PRIMARY"
				}
			],
			"region": "nyc",
			"envs": currentApp.app.spec.envs
		},
        app_id: "c949dfc3-64b4-4541-b16b-495993f981cd"
    })).data;
	
    sendDiscordPrompter([
        new EmbedBuilder()
            .setTitle(`Socket scaled to ${instanceCount}x \`${instanceSize}\``)
            .setDescription(`Scaled by <@` + employeeId + `>`)
            .setColor(0x5865f2) // Discord blurple for scaling/informational actions
    ]);
    await Audit.create({
        to: "2",
        toType: 'server',
        from: employeeId,
        fromType: 'employee',
        action: 'scale',
        description: `Scaled socket to ${instanceCount}x \`${instanceSize}\``
    });
    return {};
}

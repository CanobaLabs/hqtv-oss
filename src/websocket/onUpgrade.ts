import http from 'http';
import { WebSocket } from 'ws';
import HqError from '../common/hqError';
import logger from '../common/logger';
import User from '../common/types/user';
import verifyBearer from '../common/utils/verifyBearer';
import constructBroadcastEnded from './constructors/constructBroadcastEnded';
import errorWss from './errorWss';
import getConnectionGameInfo from './upgradeHelpers/getRelevantGameInfo';
import manageNewPlayerState from './upgradeHelpers/manageNewPlayerState';
import parseBroadcastId from './upgradeHelpers/parseBroadcastId';
import onClose from './wsEventHandlers/onClose';
import onMessage from './wsEventHandlers/onMessage';
import onPing from './wsEventHandlers/onPing';
import { createWsServer, wsServers } from './wsServers';
import getDiscordUser from '../api/utils/getDiscordUser';
import rGameKey from './wsTypes/redisGameKeys';
import redis from '../common/redisClient';
import CrossServer from './helpers/CrossServer';
import rKey from '../common/redisKeys';
import sendProducerPlayerList from './helpers/sendProducerPlayerList';
import handleSubscribe from './playerEventHandlers/handleSubscribe';
import { getProductionForGame } from '../api/routeHandlers/productions';
import { calculateEmployeePermissionSets } from '../api/routeHandlers/employees';
import eligibleChampions from '../season2eligible.json';

const onUpgrade = function(server: http.Server) {
    server.on('upgrade', async (request, socket, head) => {
        socket.on('error', e => logger.error('Socket error', e));

        const broadcastId = parseBroadcastId(request.url);
        if (broadcastId == null) {
            return socket.destroy();
        }

        // auth
        let user: User | null = null;
        let producer: { discordId: string; } | null = null;
        let userId!: number; // user id or bot id (bot ids are negative)
        let playerId!: string;
        
        const userAuthHeader = request.headers.authorization;
        const apAuthHeader = request.headers['sec-websocket-protocol'];
        if (userAuthHeader) {
            user = await verifyBearer(userAuthHeader).catch(() => null);
            if (user) {
                userId = user.id;
                playerId = user.id.toString();
            }
        } else if (apAuthHeader) {
            // admin panel
            const discordUser = await getDiscordUser(apAuthHeader);
            if (discordUser) {
                producer = { discordId: discordUser.userId || discordUser.id };
                userId = 2; // producer user account
                try {
                    const connCount = await redis.incr(rKey.producerConnCount);
                    playerId = (-1 - connCount).toString();
                } catch (err) {
                    logger.error('Failed to increment producer connection counter', err);
                    return errorWss.handleUpgrade(request, socket, head, (ws) => {
                        ws.sendJson(new HqError('Connection error. Please try again.', 105, 500));
                        ws.close(1000);
                    });
                }
            }
        }
        if (!user && !producer) {
            return errorWss.handleUpgrade(request, socket, head, (ws) => {
                ws.sendJson(new HqError('Auth not valid.', 105, 401));
                ws.close(1000);
            });
        }

        const seasonXp = user?.seasonXp ?? 0;
        const { gameInfo, broadcastLive, noNewPlayers, joinedBefore } = await getConnectionGameInfo(broadcastId, playerId, seasonXp);
        const { gameType, rehearsal } = gameInfo;
        
        if (producer) {
            const production = await getProductionForGame(gameInfo.gameId.toString());
            if (!production) {
                return errorWss.handleUpgrade(request, socket, head, (ws) => {
                    ws.sendJson(new HqError('Production not found for this game.', 105, 404));
                    ws.close(1000);
                });
            }
            
            const hosts = production.hosts ? production.hosts.split(',').map((id: string) => id.trim()) : [];
            const producers = production.producers ? production.producers.split(',').map((id: string) => id.trim()) : [];
            const employeeDiscordId = producer.discordId;
            
            const permissions = await calculateEmployeePermissionSets(employeeDiscordId);
            const hasProducePermission = permissions.combined.includes('game.produce');
            
            if (!hasProducePermission && !hosts.includes(employeeDiscordId) && !producers.includes(employeeDiscordId)) {
                return errorWss.handleUpgrade(request, socket, head, (ws) => {
                    ws.sendJson(new HqError('Only hosts and producers of this game can connect as a producer.', 105, 403));
                    ws.close(1000);
                });
            }
        }
        
        if (!broadcastLive) {
            return errorWss.handleUpgrade(request, socket, head, (ws) => {
                ws.sendGameClient(constructBroadcastEnded());
                ws.close(1000);
            });
        }
        if (rehearsal) {
            if (!user?.tester && !user?.admin && !producer) {
                return errorWss.handleUpgrade(request, socket, head, (ws) => {
                    ws.sendJson(new HqError('not authorized', 102));
                    ws.close(1000);
                });
            }
        }
        if (gameInfo.gameId == 1027 && !eligibleChampions.includes(userId) && !producer) {
            return errorWss.handleUpgrade(request, socket, head, (ws) => {
                ws.sendJson(new HqError('not authorized', 102));
                ws.close(1000);
            });
        }
        if (!producer) {
            await manageNewPlayerState(gameInfo, playerId, seasonXp, noNewPlayers, joinedBefore);
        }

        const existWsServer = wsServers[broadcastId];
        const { wss } = existWsServer?.active ? existWsServer : await createWsServer(broadcastId);
        wss.handleUpgrade(request, socket, head, (ws) => {
            Object.assign(ws, {
                userId: userId,
                playerId: playerId,
                broadcastId: broadcastId,
                player: { playerId, broadcastId },
                producer: producer, 
                xHqClient: request.headers['x-hq-client'] as string | undefined
            });

            if (!producer) {
                CrossServer.sendAllServers('disconnectLastClient', broadcastId, { playerId, newSessionUuid: ws.sessionUuid }); // disconnect other clients connected on the same account
                redis.hSet(rGameKey(broadcastId).xHqClient, playerId, ws.xHqClient ?? '');
                onPing(ws); // once off
            } else {
                // Producers don't need heartbeat checks, but ensure isAlive is set
                ws.isAlive = true;
                // Auto-subscribe producers so they receive all messages and get initial game state
                handleSubscribe(ws).catch(err => {
                    logger.error('Failed to auto-subscribe producer', { 
                        err, 
                        broadcastId, 
                        playerId, 
                        userId: ws.userId,
                        errorMessage: err instanceof Error ? err.message : String(err),
                        errorStack: err instanceof Error ? err.stack : undefined
                    });
                });
                // Send player list when producer joins
                sendProducerPlayerList(broadcastId).catch(err => logger.error('Failed to send producer player list', err));
            }

            // Send player list update when a player connects (non-producer)
            if (!producer) {
                sendProducerPlayerList(broadcastId).catch(err => logger.error('Failed to send producer player list on connect', err));
            }

            ws.on('error', (e) => logger.error(e));
            ws.on('message', (data: string) => onMessage(ws, data, gameType));
            ws.on('ping', () => onPing(ws));
            ws.on('close', () => onClose(ws));
        });
    });
}

export default onUpgrade;

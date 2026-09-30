import { GameBanLevel } from '../../common/enums';
import redis from '../../common/redisClient';
import { getUser } from '../../common/utils/userGetters';
import HqWebSocket from '../wsTypes/HqWebSocket';
import { WebSocket } from 'ws';
import constructBroadcastEnded from '../constructors/constructBroadcastEnded';
import constructBroadcastStats from '../constructors/constructBroadcastStats';
import constructDisableChat from '../constructors/constructDisableChat';
import constructGameStatus from '../constructors/constructGameStatus';
import constructViewerEvent from '../constructors/constructViewerEvent';
import constructViewerUpdate from '../constructors/constructViewerUpdate';
import { CurrentStateType, currentStateConstructors } from '../wsTypes/currentStateEvents';
import advanceStreak from '../helpers/advanceStreak';
import { getViewerState, sendFriends } from '../helpers/playerMethods';
import rGameKey from '../wsTypes/redisGameKeys';
import getGameInfo from '../helpers/getGameInfo';
import HqStartRound from '../wsMessageTypes/HqStartRound';
import constructStreak from '../constructors/constructStreak';
import sendProducerPlayerList from '../helpers/sendProducerPlayerList';
import logger from '../../common/logger';

async function handleSubscribe(ws: HqWebSocket) {
    const { playerId, broadcastId } = ws;
    const isProducer = !!ws.producer;
    
    // For producers, try to get user but don't fail if it doesn't exist
    const userPromise = isProducer 
        ? getUser(ws.userId).catch(() => null)
        : getUser(ws.userId);
    
    const [user, gameInfo, currentStateType, kicked, joinedBefore, viewerState] = await Promise.all([
        userPromise,
        getGameInfo(broadcastId),
        redis.get(rGameKey(broadcastId).currentState) as Promise<CurrentStateType | null>,
        redis.sIsMember(rGameKey(broadcastId).kicked, playerId),
        redis.sIsMember(rGameKey(broadcastId).joinedPlayers, playerId),
        isProducer ? Promise.resolve(null) : getViewerState(ws.player)
    ]);
    
    // Skip player-specific checks for producers
    if (!isProducer) {
        if (kicked || (user && user.gameBan === GameBanLevel.JoinBan)) {
            // previously kicked
            ws.sendGameClient(constructBroadcastEnded('You have been removed from the game for a violation of HQTV\'s Terms of Service and Contest Rules.'));
            return ws.close(1000);
        }
        
        if (!ws.subscribed) {
            if (!joinedBefore) {
                const joinTime = Date.now();
                redis.sAdd(rGameKey(broadcastId).joinedPlayers, playerId);
                redis.hSet(rGameKey(broadcastId).joinTime, playerId, new Date(joinTime).toISOString());
                if (gameInfo.forReal) advanceStreak(ws.broadcastId, playerId, joinTime).then(r => r && ws.sendGameClient(constructStreak(r.target, r.current)));
                if (user) {
                    sendFriends(ws.player, constructViewerEvent(`${user.dispName} joined the game.`, 'joined', [user.dispName], user.id)); // only send once
                }
                // Send player list update to producers when a new player joins
                sendProducerPlayerList(broadcastId).catch(err => logger.error('Failed to send producer player list on player join', err));
            }
            if (user && viewerState) {
                sendFriends(ws.player, constructViewerUpdate(user, viewerState));
            }
        }
    }
    ws.subscribed = true;

    let currentState: Record<string, unknown> | null = null;
    try {
        if (currentStateType) {
            const constructor = currentStateConstructors[currentStateType];
            [currentState] = await constructor?.(gameInfo)(broadcastId, [playerId]) ?? [null];
        }
    } catch (err) {
        logger.error('Failed to construct current state for producer', { err, broadcastId, playerId, currentStateType });
    }

    // send at once - wrap in try-catch for producers to handle errors gracefully
    try {
        let gameStatus: Record<string, unknown> | null = null;
        let broadcastStats: Record<string, unknown> | null = null;
        
        try {
            gameStatus = await constructGameStatus(gameInfo, ws, currentState);
        } catch (err) {
            logger.error('Failed to construct game status for producer', { 
                err, 
                broadcastId, 
                playerId,
                errorMessage: err instanceof Error ? err.message : String(err),
                errorStack: err instanceof Error ? err.stack : undefined
            });
            // Continue even if gameStatus fails
        }
        
        try {
            broadcastStats = await constructBroadcastStats(ws.broadcastId, ws.userId);
        } catch (err) {
            logger.error('Failed to construct broadcast stats for producer', { 
                err, 
                broadcastId, 
                playerId,
                errorMessage: err instanceof Error ? err.message : String(err),
                errorStack: err instanceof Error ? err.stack : undefined
            });
            // Continue even if broadcastStats fails
        }
        
        // Check if websocket is still open before sending
        if (ws.readyState === WebSocket.OPEN) {
            if (gameStatus) {
                try {
                    ws.sendGameClient(gameStatus);
                } catch (err) {
                    logger.error('Failed to send game status to producer', { 
                        err, 
                        broadcastId, 
                        playerId,
                        errorMessage: err instanceof Error ? err.message : String(err)
                    });
                }
            }
            
            if (broadcastStats) {
                try {
                    ws.sendGameClient(broadcastStats);
                } catch (err) {
                    logger.error('Failed to send broadcast stats to producer', { 
                        err, 
                        broadcastId, 
                        playerId,
                        errorMessage: err instanceof Error ? err.message : String(err)
                    });
                }
            }

            if ((currentState as HqStartRound)?.type === 'startRound' && broadcastStats) {
                setTimeout(() => {
                    if (ws.readyState === WebSocket.OPEN && broadcastStats) {
                        try {
                            ws.sendGameClient(broadcastStats); // 1 1 1 counts
                        } catch (err) {
                            logger.error('Failed to send delayed broadcast stats to producer', { 
                                err, 
                                broadcastId, 
                                playerId
                            });
                        }
                    }
                }, 200);
            }

            const { chatDisabled } = gameInfo;
            if (+chatDisabled) {
                try {
                    ws.sendGameClient(constructDisableChat(+chatDisabled));
                } catch (err) {
                    logger.error('Failed to send chat disabled to producer', { 
                        err, 
                        broadcastId, 
                        playerId
                    });
                }
            }
        } else {
            logger.warn('WebSocket not open when trying to send initial state to producer', { 
                broadcastId, 
                playerId,
                readyState: ws.readyState
            });
        }
    } catch (err) {
        // For producers, log but don't fail - they're still subscribed
        if (isProducer) {
            logger.error('Unexpected error sending initial game state to producer', { 
                err, 
                broadcastId, 
                playerId,
                errorMessage: err instanceof Error ? err.message : String(err),
                errorStack: err instanceof Error ? err.stack : undefined
            });
        } else {
            throw err; // Re-throw for regular players
        }
    }
}

export default handleSubscribe;

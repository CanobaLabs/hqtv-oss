import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import logger from '../../../common/logger';
import HqError from '../../../common/hqError';
import { OutlineCollaborationWebSocket, OutlineEditMessage, OutlineSubscribeMessage, OutlineUnsubscribeMessage, OutlineEditOperation, OutlineItem, OutlineEditBroadcast, OutlineEditorInfo, OutlineEditorsBroadcast, OutlineSyncMessage, OutlineChatMessage, OutlineChatTypingMessage, OutlineChatTypingBroadcast } from './types';
import { outline } from '../../../common/mongoClient';
import Game from '../../../common/database/eventModels/game';
import Broadcast from '../../../common/database/eventModels/broadcast';
import Audit from '../../../common/database/adminModels/audit';
import { handleOutlineEdit } from './handlers';
import getDiscordUser from '../../utils/getDiscordUser';
import { calculateEmployeePermissionSets } from '../../routeHandlers/employees';
import axios from 'axios';
import redis from '../../../common/redisClient';
import rKey from '../../../common/redisKeys';
import ms from 'ms';
import getGeneralConfig from '../../utils/getGeneralConfig';
import { getProductionForGame } from '../../routeHandlers/productions';
import getSchedule from '../../utils/generateSchedule';
import { commandOptions } from 'redis';
import { BaseChatMessage } from '../../../common/types/chatMessage';
import { cacheOutline } from '../../../common/utils/gameDataCache';

// Track active connections per game
const gameConnections: Map<number, Set<OutlineCollaborationWebSocket>> = new Map();
// Track which items are being edited by which users
const editingState: Map<number, Map<number, OutlineEditorInfo>> = new Map(); // gameId -> itemId -> editor info
// Track outline versions for optimistic locking
const outlineVersions: Map<number, number> = new Map(); // gameId -> version
// Track typing state per game
const typingState: Map<number, Map<string, { employeeId: string; employeeName: string; timeout: NodeJS.Timeout }>> = new Map(); // gameId -> employeeId -> typing info
const TYPING_TIMEOUT_MS = 3000; // 3 seconds

const DISCORD_CDN_BASE_URL = 'https://cdn.discordapp.com';
const MAX_MESSAGE_LENGTH = 2000;

function getOutlineChatKey(gameId: number): string {
    return `game:${gameId}:outlineChat`;
}

function getDiscordAvatarUrl(userId: string, avatarId: string | null): string {
    if (avatarId) {
        const extension = avatarId.startsWith('a_') ? 'gif' : 'png';
        return `${DISCORD_CDN_BASE_URL}/avatars/${userId}/${avatarId}.${extension}`;
    }
    const defaultAvatarIndex = parseInt(userId) % 5;
    return `${DISCORD_CDN_BASE_URL}/embed/avatars/${defaultAvatarIndex}.png`;
}

function constructOutlineChat(data: BaseChatMessage): OutlineChatMessage {
    return {
        type: 'producerChat',
        messageId: data.messageId,
        employeeId: data.employeeId,
        employeeName: data.employeeName,
        avatarUrl: data.avatarUrl,
        message: data.message,
        edited: data.edited,
        editedBy: data.editedBy,
        editedAt: data.editedAt,
        originalMessageId: data.originalMessageId
    };
}

function getOrCreateGameConnections(gameId: number): Set<OutlineCollaborationWebSocket> {
    if (!gameConnections.has(gameId)) {
        gameConnections.set(gameId, new Set());
    }
    return gameConnections.get(gameId)!;
}

function getOrCreateEditingState(gameId: number): Map<number, OutlineEditorInfo> {
    if (!editingState.has(gameId)) {
        editingState.set(gameId, new Map());
    }
    return editingState.get(gameId)!;
}

function broadcastToGame(gameId: number, message: unknown, excludeWs?: OutlineCollaborationWebSocket) {
    const connections = gameConnections.get(gameId);
    if (!connections) return;
    
    const messageStr = JSON.stringify(message);
    connections.forEach(ws => {
        if (ws !== excludeWs && ws.readyState === 1) { // WebSocket.OPEN = 1
            try {
                ws.send(messageStr);
            } catch (err) {
                logger.error({ err, gameId }, 'Failed to send message to WebSocket client');
            }
        }
    });
}

export function broadcastOutlineChatMessage(gameId: number, message: OutlineChatMessage): void {
    broadcastToGame(gameId, message);
}

function updateEditingState(gameId: number, itemId: number | null, editor: OutlineEditorInfo | null) {
    const state = getOrCreateEditingState(gameId);
    if (itemId !== null && editor !== null) {
        state.set(itemId, editor);
    } else if (itemId !== null) {
        state.delete(itemId);
    }
    
    // Broadcast updated editor list
    const editors: OutlineEditorInfo[] = Array.from(state.values());
    broadcastToGame(gameId, {
        type: 'outline_editors',
        gameId,
        editors
    } as OutlineEditorsBroadcast);
}

function sendEditorsList(ws: OutlineCollaborationWebSocket, gameId: number) {
    const state = editingState.get(gameId);
    if (!state) return;
    
    const editors: OutlineEditorInfo[] = Array.from(state.values());
    ws.sendJson({
        type: 'outline_editors',
        gameId,
        editors
    } as OutlineEditorsBroadcast);
}

async function isUserWriterHostOrProducer(gameId: number, employeeDiscordId: string): Promise<boolean> {
    const production = await getProductionForGame(gameId.toString());
    if (!production) {
        return false;
    }
    
    const hosts = production.hosts ? production.hosts.split(',').map((id: string) => id.trim()) : [];
    const writers = production.writers ? production.writers.split(',').map((id: string) => id.trim()) : [];
    const producers = production.producers ? production.producers.split(',').map((id: string) => id.trim()) : [];
    
    const crewSet = new Set([...hosts, ...writers, ...producers]);
    return crewSet.has(employeeDiscordId);
}

async function loadOutline(gameId: number): Promise<OutlineItem[]> {
    const gameOutline = await outline.findOne({ gameId }).exec();
    if (!gameOutline || !gameOutline.outline) {
        return [];
    }
    // Convert Mongoose document array to plain array
    return JSON.parse(JSON.stringify(gameOutline.outline)) as OutlineItem[];
}

async function loadChatHistory(gameId: number): Promise<OutlineChatMessage[]> {
    try {
        const chatLog = await redis.xRead(commandOptions({ isolated: true }), [
            {
                key: getOutlineChatKey(gameId),
                id: '0-0'
            }
        ], {
            COUNT: 1000
        });
        
        if (!chatLog?.[0]?.messages) return [];
        
        return chatLog[0].messages.map(msg => constructOutlineChat({
            messageId: msg.id,
            employeeId: msg.message.employeeId,
            employeeName: msg.message.employeeName,
            avatarUrl: msg.message.avatarUrl,
            message: msg.message.message
        }));
    } catch (err) {
        logger.error({ err, gameId }, 'Failed to load outline chat history');
        return [];
    }
}

async function saveOutline(gameId: number, outlineItems: OutlineItem[], employeeId: string): Promise<void> {
    const gameOutline = await outline.findOne({ gameId }).exec();
    if (gameOutline) {
        gameOutline.outline = outlineItems as any;
        await gameOutline.save();
    } else {
        await outline.create({ gameId, outline: outlineItems });
    }
    
    // Cache in Redis (don't await - fire and forget)
    cacheOutline(gameId, { outline: outlineItems }).catch(() => {});
    
    // Increment version
    const currentVersion = outlineVersions.get(gameId) ?? 0;
    outlineVersions.set(gameId, currentVersion + 1);
}

async function handleSubscribe(ws: OutlineCollaborationWebSocket, message: OutlineSubscribeMessage) {
    const { gameId } = message;
    
    if (!ws.employeeId) {
        ws.sendJson(new HqError('Not authenticated', 0, 401));
        return;
    }
    
    // Verify game exists
    const game = await Game.findOne({ where: { gameId: gameId.toString() } });
    if (!game) {
        ws.sendJson(new HqError('Game not found', 0, 404));
        return;
    }
    
    // Check access: must be writer/host/producer OR have outline.view permission
    const isGameMember = await isUserWriterHostOrProducer(gameId, ws.employeeId);
    const hasViewPermission = ws.canView === true;
    
    if (!isGameMember && !hasViewPermission) {
        ws.sendJson(new HqError('Forbidden. Must be a writer, host, or producer of this game, or have outline.view permission.', 102, 403));
        return;
    }
    
    ws.gameId = gameId;
    const connections = getOrCreateGameConnections(gameId);
    connections.add(ws);
    
    // Check if game is currently live
    const activeBroadcast = await Broadcast.findOne({ 
        where: { 
            gameId: gameId.toString(), 
            ended: null 
        } 
    });
    const isLive = !!activeBroadcast;
    
    // Load and send current outline
    const outlineItems = await loadOutline(gameId);
    const version = outlineVersions.get(gameId) ?? 0;
    
    ws.sendJson({
        type: 'outline_sync',
        gameId,
        outline: outlineItems,
        version,
        isLive  // Include live status so client can disable edits
    } as OutlineSyncMessage & { isLive: boolean });
    
    // Send current editors
    sendEditorsList(ws, gameId);
    
    // Load and send chat history
    const chatHistory = await loadChatHistory(gameId);
    if (chatHistory.length > 0) {
        for (const chatMessage of chatHistory) {
            ws.sendJson(chatMessage);
        }
    }
    
    logger.info({ gameId, userId: ws.userId, isLive }, 'Outline collaboration: client subscribed');
}

function handleUnsubscribe(ws: OutlineCollaborationWebSocket, message: OutlineUnsubscribeMessage) {
    const { gameId } = message;
    
    if (ws.gameId === gameId) {
        const connections = gameConnections.get(gameId);
        if (connections) {
            connections.delete(ws);
            if (connections.size === 0) {
                gameConnections.delete(gameId);
                editingState.delete(gameId);
                typingState.delete(gameId);
            }
        }
        
        // Remove from editing state
        const state = editingState.get(gameId);
        if (state) {
            for (const [itemId, editor] of state.entries()) {
                if (editor.userId === ws.userId) {
                    state.delete(itemId);
                }
            }
            if (state.size > 0) {
                broadcastToGame(gameId, {
                    type: 'outline_editors',
                    gameId,
                    editors: Array.from(state.values())
                } as OutlineEditorsBroadcast);
            }
        }
        
        // Remove from typing state
        if (ws.employeeId) {
            const typingStateMap = typingState.get(gameId);
            if (typingStateMap) {
                const existingTyping = typingStateMap.get(ws.employeeId);
                if (existingTyping) {
                    clearTimeout(existingTyping.timeout);
                    typingStateMap.delete(ws.employeeId);
                    if (typingStateMap.size === 0) {
                        typingState.delete(gameId);
                    } else {
                        broadcastTypingUpdate(gameId, ws.employeeId, ws.userName || 'Unknown', false);
                    }
                }
            }
        }
    }
    
    logger.info({ gameId, userId: ws.userId }, 'Outline collaboration: client unsubscribed');
}

async function handleEdit(ws: OutlineCollaborationWebSocket, message: OutlineEditMessage) {
    if (!ws.gameId || !ws.userId || !ws.employeeId) {
        ws.sendJson(new HqError('Not authenticated or subscribed', 0, 401));
        return;
    }
    
    const { gameId, operation } = message;
    
    if (gameId !== ws.gameId) {
        ws.sendJson(new HqError('Game ID mismatch', 0, 400));
        return;
    }
    
    // Check access: must be writer/host/producer OR have outline.edit permission
    const isGameMember = await isUserWriterHostOrProducer(gameId, ws.employeeId);
    const hasEditPermission = ws.canEdit === true;
    
    if (!isGameMember && !hasEditPermission) {
        ws.sendJson(new HqError('Forbidden. Must be a writer, host, or producer of this game, or have outline.edit permission.', 102, 403));
        return;
    }
    
    // Check if game is currently live (has an active broadcast)
    const activeBroadcast = await Broadcast.findOne({ 
        where: { 
            gameId: gameId.toString(), 
            ended: null 
        } 
    });
    
    if (activeBroadcast) {
        ws.sendJson(new HqError('Cannot edit outline while game is live', 0, 403));
        return;
    }
    
    try {
        // Load current outline and game details
        const [outlineItems, game] = await Promise.all([
            loadOutline(gameId),
            Game.findOne({ where: { gameId: gameId.toString() } })
        ]);
        if (!game) {
            ws.sendJson(new HqError('Game not found', 0, 404));
            return;
        }
        const isSumPrizeGame = game.sumPrize === 1;
        // Use Map for O(1) lookup instead of O(n) find
        const itemByIdMap = new Map(outlineItems.map((item, index) => [item.id, { item, index }]));
        const targetItem = 'itemId' in operation
            ? itemByIdMap.get(operation.itemId)?.item
            : undefined;
        const shouldRefreshSchedule =
            isSumPrizeGame &&
            targetItem?.itemType === 'checkpoint' &&
            (
                (operation.type === 'update' &&
                    (
                        ('prizeCents' in operation.changes && operation.changes.prizeCents !== targetItem.prizeCents) ||
                        ('prizePoints' in operation.changes && operation.changes.prizePoints !== targetItem.prizePoints)
                    )
                ) ||
                (operation.type === 'updateField' &&
                    (operation.field === 'prizeCents' || operation.field === 'prizePoints') &&
                    operation.value !== targetItem?.[operation.field]
                )
            );
        
        // Apply operation
        const result = handleOutlineEdit(outlineItems, operation, ws.employeeId, ws.userName || 'Unknown');
        
        // Save to database
        await saveOutline(gameId, result.outline, ws.employeeId);
        if (shouldRefreshSchedule) {
            await Promise.all([
                getSchedule('normal', true),
                getSchedule('rehearsal', true),
                getSchedule('all', true)
            ]);
        }
        
        // Check again if game became live during the operation (race condition protection)
        const stillActiveBroadcast = await Broadcast.findOne({ 
            where: { 
                gameId: gameId.toString(), 
                ended: null 
            } 
        });
        
        if (stillActiveBroadcast) {
            // Game became live during edit - this shouldn't happen but protect against it
            logger.warn({ gameId, userId: ws.userId }, 'Game became live during outline edit operation');
            ws.sendJson(new HqError('Game became live during edit operation', 0, 403));
            return;
        }
        
        // Broadcast change to all other clients
        const broadcast: OutlineEditBroadcast = {
            type: 'outline_edit_broadcast',
            gameId,
            operation,
            userId: ws.userId,
            userName: ws.userName || 'Unknown',
            timestamp: Date.now()
        };
        
        broadcastToGame(gameId, broadcast, ws);
        
        // Update editing state if needed
        if (operation.type === 'update' || operation.type === 'updateField') {
            updateEditingState(gameId, operation.itemId, {
                userId: ws.userId!,
                userName: ws.userName || ws.userId || 'Unknown',
                editingItemId: operation.itemId
            });
        } else if (operation.type === 'delete') {
            updateEditingState(gameId, operation.itemId, null);
        }
        
        // Send confirmation
        ws.sendJson({
            type: 'outline_edit_success',
            gameId,
            operation,
            version: outlineVersions.get(gameId) ?? 0
        });
        
    } catch (err) {
        logger.error({ err, gameId, operation }, 'Failed to handle outline edit');
        if (err instanceof HqError) {
            ws.sendJson(err);
        } else {
            const errorMessage = err instanceof Error ? err.message : 'Failed to apply edit';
            ws.sendJson(new HqError(errorMessage, 0, 500));
        }
    }
}

async function handleChat(ws: OutlineCollaborationWebSocket, message: { type: string; metadata?: { message: string } }) {
    if (!ws.gameId || !ws.employeeId) {
        ws.sendJson(new HqError('Not authenticated or subscribed', 0, 401));
        return;
    }
    
    const gameId = ws.gameId;
    
    const chatMessage = message.metadata?.message;
    if (!chatMessage || typeof chatMessage !== 'string') {
        return;
    }
    
    const trimmedMessage = chatMessage.trim();
    if (trimmedMessage.length === 0 || trimmedMessage.length > MAX_MESSAGE_LENGTH) {
        ws.sendJson(new HqError(`Message must be between 1 and ${MAX_MESSAGE_LENGTH} characters`, 400));
        return;
    }
    
    try {
        const employee = await getDiscordUser(ws.employeeId);
        if (!employee) {
            logger.error('Outline chat: Employee not found', { employeeId: ws.employeeId, gameId: ws.gameId });
            ws.sendJson(new HqError('Employee information not found', 404));
            return;
        }
        
        const avatarUrl = getDiscordAvatarUrl(employee.id, employee.avatarId);
        const employeeName = employee.name || ws.userName || 'Unknown';
        
        const messageId = await redis.xAdd(getOutlineChatKey(gameId), '*', {
            employeeId: employee.id,
            employeeName: employeeName,
            avatarUrl: avatarUrl,
            message: trimmedMessage
        });
        
        const outlineChatMessage = constructOutlineChat({
            messageId: messageId,
            employeeId: employee.id,
            employeeName: employeeName,
            avatarUrl: avatarUrl,
            message: trimmedMessage
        });
        
        broadcastToGame(gameId, outlineChatMessage);
    } catch (err) {
        logger.error('Outline chat error', {
            err,
            gameId: ws.gameId,
            employeeId: ws.employeeId,
            errorMessage: err instanceof Error ? err.message : String(err)
        });
        ws.sendJson(new HqError('Failed to send chat message', 500));
    }
}

function getOrCreateTypingState(gameId: number): Map<string, { employeeId: string; employeeName: string; timeout: NodeJS.Timeout }> {
    if (!typingState.has(gameId)) {
        typingState.set(gameId, new Map());
    }
    return typingState.get(gameId)!;
}

function broadcastTypingUpdate(gameId: number, employeeId: string, employeeName: string, isTyping: boolean) {
    const broadcast: OutlineChatTypingBroadcast = {
        type: 'outline_chat_typing',
        gameId,
        employeeId,
        employeeName,
        isTyping
    };
    broadcastToGame(gameId, broadcast);
}

async function handleTyping(ws: OutlineCollaborationWebSocket, message: OutlineChatTypingMessage) {
    if (!ws.gameId || !ws.employeeId || !ws.userName) {
        return;
    }
    
    const gameId = ws.gameId;
    const employeeId = ws.employeeId;
    const employeeName = ws.userName;
    const typingStateMap = getOrCreateTypingState(gameId);
    
    const existingTyping = typingStateMap.get(employeeId);
    if (existingTyping) {
        clearTimeout(existingTyping.timeout);
    }
    
    if (message.isTyping) {
        const timeout = setTimeout(() => {
            const state = typingStateMap.get(employeeId);
            if (state) {
                typingStateMap.delete(employeeId);
                if (typingStateMap.size === 0) {
                    typingState.delete(gameId);
                }
                broadcastTypingUpdate(gameId, employeeId, employeeName, false);
            }
        }, TYPING_TIMEOUT_MS);
        
        typingStateMap.set(employeeId, {
            employeeId: employeeId,
            employeeName: employeeName,
            timeout
        });
        
        broadcastTypingUpdate(gameId, employeeId, employeeName, true);
    } else {
        if (existingTyping) {
            typingStateMap.delete(employeeId);
            if (typingStateMap.size === 0) {
                typingState.delete(gameId);
            }
        }
        broadcastTypingUpdate(gameId, employeeId, employeeName, false);
    }
}

function handleMessage(ws: OutlineCollaborationWebSocket, data: string) {
    let message: unknown;
    try {
        message = JSON.parse(data);
    } catch {
        ws.sendJson(new HqError('Invalid JSON', 0, 400));
        return;
    }
    
    if (!message || typeof message !== 'object' || !('type' in message)) {
        ws.sendJson(new HqError('Invalid message format', 0, 400));
        return;
    }
    
    const msgType = (message as { type: string }).type;
    
    switch (msgType) {
        case 'outline_subscribe':
            handleSubscribe(ws, message as OutlineSubscribeMessage);
            break;
        case 'outline_unsubscribe':
            handleUnsubscribe(ws, message as OutlineUnsubscribeMessage);
            break;
        case 'outline_edit':
            handleEdit(ws, message as OutlineEditMessage);
            break;
        case 'producerChat':
            handleChat(ws, message as { type: string; metadata?: { message: string } }).catch(err => {
                logger.error({ err }, 'Error handling outline chat');
            });
            break;
        case 'outline_chat_typing':
            handleTyping(ws, message as OutlineChatTypingMessage).catch(err => {
                logger.error({ err }, 'Error handling outline chat typing');
            });
            break;
        case 'ping':
            ws.sendJson({ type: 'pong' });
            break;
        default:
            ws.sendJson(new HqError(`Unknown message type: ${msgType}`, 0, 400));
    }
}

function handleClose(ws: OutlineCollaborationWebSocket) {
    if (ws.gameId && ws.employeeId) {
        // Clean up typing state on disconnect
        const typingStateMap = typingState.get(ws.gameId);
        if (typingStateMap) {
            const existingTyping = typingStateMap.get(ws.employeeId);
            if (existingTyping) {
                clearTimeout(existingTyping.timeout);
                typingStateMap.delete(ws.employeeId);
                if (typingStateMap.size === 0) {
                    typingState.delete(ws.gameId);
                } else {
                    broadcastTypingUpdate(ws.gameId, ws.employeeId, ws.userName || 'Unknown', false);
                }
            }
        }
        handleUnsubscribe(ws, { type: 'outline_unsubscribe', gameId: ws.gameId });
    }
}

function decodeBase64Url(input: string): string {
    const padLength = (4 - (input.length % 4)) % 4;
    const normalized = `${input}${'='.repeat(padLength)}`.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(normalized, 'base64').toString('utf8');
}

function parseCfAccessToken(rawToken: string | undefined): { custom?: { id?: string; }; sub?: string; identity?: { id?: string; }; } | null {
    if (!rawToken) {
        return null;
    }
    const token = rawToken.trim();
    const segments = token.split('.');
    if (segments.length < 2) {
        return null;
    }
    try {
        const payloadJson = decodeBase64Url(segments[1]);
        return JSON.parse(payloadJson);
    } catch {
        return null;
    }
}

async function authenticateWebSocket(request: http.IncomingMessage): Promise<{ userId: string; employeeId: string; userName: string; canView: boolean; canEdit: boolean } | null> {
    // Check for sec-websocket-protocol header first (preferred for WebSocket)
    const protocolHeader = request.headers['sec-websocket-protocol'];
    let authToken: string | null = null;
    
    if (protocolHeader) {
        // sec-websocket-protocol can be a string or array, get first value
        authToken = Array.isArray(protocolHeader) ? protocolHeader[0] : protocolHeader;
    } else {
        // Fallback to Authorization header
        const authHeader = request.headers.authorization;
        if (authHeader && typeof authHeader === 'string') {
            // Skip Bearer tokens (those are for user auth, not employee auth)
            if (!authHeader.trim().startsWith('Bearer ')) {
                authToken = authHeader.trim();
            }
        }
    }
    
    if (!authToken) {
        return null;
    }
    
    try {
        const cfAuthHeader = authToken;
        const tokenPayload = parseCfAccessToken(cfAuthHeader);
        const userIdFromToken = tokenPayload?.custom?.id ?? tokenPayload?.identity?.id ?? tokenPayload?.sub;
        const nowIso = new Date().toISOString();
        
        let user: Awaited<ReturnType<typeof getDiscordUser>> = null;
        
        // Try to get user from Redis first (by userId from token)
        if (userIdFromToken) {
            user = await getDiscordUser(userIdFromToken);
        }
        
        // Try cached auth by token (token -> userId mapping)
        if (!user) {
            const cachedAuth = await redis.exists(rKey.employee(cfAuthHeader));
            if (cachedAuth) {
                user = await getDiscordUser(cfAuthHeader);
            }
        }
        
        // If still no user, try Cloudflare Access API to get employee ID, then look up in Redis
        // We ONLY use Cloudflare to get the ID - the employee data (including name) comes from Redis
        if (!user) {
            try {
                const { data } = await axios.get('https://canobal.cloudflareaccess.com/cdn-cgi/access/get-identity', {
                    headers: { cookie: "CF_Authorization=" + cfAuthHeader }
                });
                
                // Get employee ID from Cloudflare response
                const employeeId = data?.custom?.id;
                if (employeeId) {
                    // Look up employee in Redis by ID - this is where we get the name
                    user = await getDiscordUser(employeeId);
                    
                    // If not found in Redis, they're not an employee - reject
                    if (!user) {
                        return null;
                    }
                    
                    // Cache the token -> userId mapping for faster future lookups
                    // But don't create/modify employee data - that comes from Redis
                    const cachedAuth = await redis.exists(rKey.employee(cfAuthHeader));
                    if (!cachedAuth) {
                        const config = await getGeneralConfig();
                        await redis.multi()
                            .hSet(rKey.employee(cfAuthHeader), 'userId', employeeId)
                            .pExpire(rKey.employee(cfAuthHeader), ms(`${config.employeeCacheExpiryHours} hours`))
                            .exec();
                    }
                }
            } catch (cfErr) {
                logger.debug({ err: cfErr }, 'Failed to fetch user from Cloudflare Access API');
            }
        }
        
        // If still no user, they're not an employee
        if (!user || !user.userId) {
            return null;
        }
        
        // Update last online
        await redis.set(rKey.employeeLastOnline(user.userId), nowIso);
        
        // Check permissions - user must be an employee (getDiscordUser returning non-null confirms this)
        const permissions = await calculateEmployeePermissionSets(user.userId);
        const canView = permissions.combined.includes('outline.view');
        const canEdit = permissions.combined.includes('outline.edit');
        
        // Allow connection - game-specific access will be checked when subscribing to a game
        
        // Get user name from employee object in Redis - this is the source of truth
        // The name should always be in Redis for employees
        if (!user.name || !user.name.trim()) {
            logger.warn({ userId: user.userId }, 'Employee name missing in Redis - this should not happen for valid employees');
        }
        
        const userName = (user.name && user.name.trim()) 
            ? user.name.trim() 
            : (user.userId || 'Unknown');
        
        return {
            userId: user.userId,
            employeeId: user.userId,
            userName: userName,
            canView,
            canEdit
        };
    } catch (err) {
        logger.error({ err }, 'Failed to authenticate WebSocket connection');
        return null;
    }
}

export function createOutlineCollaborationServer(server: http.Server) {
    const wss = new WebSocketServer({ noServer: true });
    
    server.on('upgrade', async (request, socket, head) => {
        // Only handle outline collaboration connections
        const requestUrl = request.url || '';
        if (!requestUrl.startsWith('/outline-collaboration')) {
            return;
        }
        
        // Authenticate before upgrading
        const auth = await authenticateWebSocket(request);
        if (!auth) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
        }
        
        wss.handleUpgrade(request, socket, head, (ws) => {
            const outlineWs = ws as unknown as OutlineCollaborationWebSocket;
            
            // Set authentication info
            outlineWs.userId = auth.userId;
            outlineWs.employeeId = auth.employeeId;
            outlineWs.userName = auth.userName;
            outlineWs.canView = auth.canView;
            outlineWs.canEdit = auth.canEdit;
            
            // Add sendJson helper
            outlineWs.sendJson = (data: unknown) => {
                if (outlineWs.readyState === 1) {
                    outlineWs.send(JSON.stringify(data));
                }
            };
            
            outlineWs.on('message', (data: Buffer) => {
                handleMessage(outlineWs, data.toString());
            });
            
            outlineWs.on('close', () => {
                handleClose(outlineWs);
            });
            
            outlineWs.on('error', (err) => {
                logger.error({ err }, 'Outline collaboration WebSocket error');
            });
            
            // Send welcome message
            outlineWs.sendJson({
                type: 'outline_connected',
                message: 'Connected to outline collaboration server'
            });
        });
    });
    
    logger.info('Outline collaboration WebSocket server initialized');
    return wss;
}


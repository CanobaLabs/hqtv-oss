import redis from '../../common/redisClient';
import { bulkGetUsers } from '../../common/utils/userGetters';
import rGameKey from '../wsTypes/redisGameKeys';
import { wsServers } from '../wsServers';

export interface ProducerPlayer {
    playerId: string;
    userId: number;
    name: string;
    status: 'playing' | 'eliminated';
    connected: boolean;
    gameBan: number;
    appBan: number;
    chatBan: number;
    platform: string;
}

async function constructProducerPlayerList(broadcastId: number): Promise<{
    type: 'producerPlayerList';
    players: ProducerPlayer[];
}> {
    // Get all players who have joined
    const allPlayerIds = await redis.sMembers(rGameKey(broadcastId).joinedPlayers);
    
    if (allPlayerIds.length === 0) {
        return {
            type: 'producerPlayerList',
            players: []
        };
    }

    // Get playing status for all players
    const [playingStatuses, solvingStatuses] = await Promise.all([
        redis.smIsMember(rGameKey(broadcastId).inTheGame, allPlayerIds),
        redis.smIsMember(rGameKey(broadcastId).solvingPlayers, allPlayerIds)
    ]);

    // Create a map of playerId -> status for efficient lookup
    const playerStatusMap = new Map<string, 'playing' | 'eliminated'>();
    allPlayerIds.forEach((playerId, i) => {
        const status = playingStatuses[i] || solvingStatuses[i] ? 'playing' : 'eliminated';
        playerStatusMap.set(playerId, status);
    });

    // Get user information for all players
    const userIds = allPlayerIds.map(id => +id).filter(id => id > 0); // Filter out negative IDs (bots/producers)
    const users = await bulkGetUsers(userIds);
    const userMap = new Map(users.map(u => [u.id.toString(), u]));

    // Get connection status and platform by checking active WebSocket clients
    const wss = wsServers[broadcastId]?.wss;
    const connectedPlayerIds = new Set<string>();
    const clientPlatformMap = new Map<string, string>();
    if (wss) {
        wss.clients.forEach(client => {
            // Only count non-producer clients as connected players
            if (!client.producer && client.playerId) {
                connectedPlayerIds.add(client.playerId);
                // Extract platform from xHqClient (e.g., "iOS/1.0.0" -> "iOS", "Android/1.53.3" -> "Android")
                if (client.xHqClient) {
                    const platform = client.xHqClient.split('/')[0] || client.xHqClient;
                    clientPlatformMap.set(client.playerId, platform);
                }
            }
        });
    }

    // Get xHqClient from Redis as fallback for players not currently connected
    const redisClientHeaders = await redis.hGetAll(rGameKey(broadcastId).xHqClient);

    // Build the player list
    const players: ProducerPlayer[] = allPlayerIds
        .filter(playerId => {
            // Only include players with valid user IDs (exclude bots/producers)
            const userId = +playerId;
            return userId > 0 && userMap.has(playerId);
        })
        .map(playerId => {
            const user = userMap.get(playerId)!;
            // Get platform from active client if available, otherwise from Redis
            let platform = '';
            if (clientPlatformMap.has(playerId)) {
                platform = clientPlatformMap.get(playerId)!;
            } else if (redisClientHeaders[playerId]) {
                const xHqClient = redisClientHeaders[playerId];
                platform = xHqClient.split('/')[0] || xHqClient;
            }
            return {
                playerId,
                userId: user.id,
                name: user.dispName,
                status: playerStatusMap.get(playerId) ?? 'eliminated',
                connected: connectedPlayerIds.has(playerId),
                gameBan: user.gameBan,
                appBan: user.appBan,
                chatBan: user.chatBan,
                platform
            };
        });

    return {
        type: 'producerPlayerList',
        players
    };
}

export default constructProducerPlayerList;

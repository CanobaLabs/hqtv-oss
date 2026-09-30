import constructBroadcastStats from '../constructors/constructBroadcastStats';
import { wsServers } from '../wsServers';

async function subBroadcastStatsHandler(broadcastId: number) {
    const wsServer = wsServers[broadcastId];
    wsServer?.wss.sendAll(await constructBroadcastStats(broadcastId));
}

export { subBroadcastStatsHandler };

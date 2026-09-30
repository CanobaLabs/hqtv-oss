import { wsServers } from '../wsServers';

interface SubSendPlayersArgs {
    playerIds: string[];
    payload: Record<string, unknown>;
}

async function subSendPlayersHandler(broadcastId: number, e: SubSendPlayersArgs) {
    wsServers[broadcastId]?.wss.clients.forEach(client => {
        if (e.playerIds.includes(client.playerId)) {
            // in this server
            client.sendGameClient(e.payload);
        }
    });
}

export { SubSendPlayersArgs, subSendPlayersHandler };

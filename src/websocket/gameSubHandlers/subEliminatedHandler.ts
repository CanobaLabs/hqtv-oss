import constructGameStatus from '../constructors/constructGameStatus';
import getGameInfo from '../helpers/getGameInfo';
import { wsServers } from '../wsServers';

interface SubEliminatedArgs {
    playerIds: string[];
}

async function subEliminatedHandler(broadcastId: number, e: SubEliminatedArgs) {
    const gameInfo = await getGameInfo(broadcastId);
    wsServers[broadcastId]?.wss.clients.forEach(async client => {
        if (e.playerIds.includes(client.playerId)) {
            client.sendGameClient(await constructGameStatus(gameInfo, client));
        }
    });
}

export { SubEliminatedArgs, subEliminatedHandler };

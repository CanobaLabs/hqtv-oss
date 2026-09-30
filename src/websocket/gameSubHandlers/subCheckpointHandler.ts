import constructCheckpoint from '../constructors/constructCheckpoint';
import getGameInfo from '../helpers/getGameInfo';
import { wsServers } from '../wsServers';

async function subCheckpointHandler(broadcastId: number) {
    const gameInfo = await getGameInfo(broadcastId);
	wsServers[broadcastId]?.wss.bulkSend(constructCheckpoint(gameInfo));
}

export default subCheckpointHandler;

import constructCheckpointSummary from '../constructors/constructCheckpointSummary';
import getGameInfo from '../helpers/getGameInfo';
import { wsServers } from '../wsServers';

async function subCheckpointSummaryHandler(broadcastId: number) {
	const gameInfo = await getGameInfo(broadcastId);
    wsServers[broadcastId]?.wss.bulkSend(constructCheckpointSummary(gameInfo));
}

export default subCheckpointSummaryHandler;


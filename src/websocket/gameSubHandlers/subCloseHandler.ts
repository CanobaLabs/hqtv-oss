import constructClose from '../constructors/constructClose';
import getGameInfo from '../helpers/getGameInfo';
import { wsServers } from '../wsServers';

async function subCloseHandler(broadcastId: number) {
    const gameInfo = await getGameInfo(broadcastId);
    wsServers[broadcastId]?.wss.bulkSend(constructClose(gameInfo));
}

export { subCloseHandler };

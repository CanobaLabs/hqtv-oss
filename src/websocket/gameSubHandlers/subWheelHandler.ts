import constructShowWheel from '../constructors/constructShowWheel';
import getGameInfo from '../helpers/getGameInfo';
import { wsServers } from '../wsServers';

async function subWheelHandler(broadcastId: number) {
    const gameInfo = await getGameInfo(broadcastId);
    wsServers[broadcastId]?.wss.sendAll(constructShowWheel(gameInfo));
}

export { subWheelHandler };

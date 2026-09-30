import redis from '../../common/redisClient';
import constructGameStatus from '../constructors/constructGameStatus';
import getGameInfo from '../helpers/getGameInfo';
import rGameKey from '../wsTypes/redisGameKeys';
import { wsServers } from '../wsServers';

async function subRevived(broadcastId: number) {
    const gameInfo = await getGameInfo(broadcastId);
    const revivedPlayerIds = await redis.sMembers(rGameKey(broadcastId).question(+gameInfo.questionNumber).savedByStaff);
    wsServers[broadcastId]?.wss.clients.forEach(async client => {
        if (revivedPlayerIds.includes(client.playerId)) {
            client.sendGameClient(await constructGameStatus(gameInfo, client));
        }
    });
}

export { subRevived };

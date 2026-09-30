import redis from '../../common/redisClient';
import { bulkGetUsers } from '../../common/utils/userGetters';
import constructViewerUpdate from '../constructors/constructViewerUpdate';
import { sendFriends } from '../helpers/playerMethods';
import rGameKey from '../wsTypes/redisGameKeys';
import WsGameInfo from '../wsTypes/WsGameInfo';
import CrossServer from '../helpers/CrossServer';
import sendProducerPlayerList from '../helpers/sendProducerPlayerList';
import logger from '../../common/logger';

async function masterEliminateHandler(gameInfo: WsGameInfo, broadcastId: number, playerIds: string[]) {
    if (playerIds.length === 0) {
        return;
    }

    const multi = redis.multi();
    const bulkInTheGame = await redis.smIsMember(rGameKey(broadcastId).inTheGame, playerIds);
    const bulkSolving = await redis.smIsMember(rGameKey(broadcastId).solvingPlayers, playerIds);
    
    const playersToEliminate = playerIds.filter((id, i) => bulkInTheGame[i] || bulkSolving[i]);
    
    if (playersToEliminate.length === 0) {
        return;
    }

    playersToEliminate.forEach(playerId => {
        multi
            .sRem(rGameKey(broadcastId).inTheGame, playerId)
            .sRem(rGameKey(broadcastId).solvingPlayers, playerId)
            .sAdd(rGameKey(broadcastId).eliminated, playerId);
        
        if (gameInfo.questionNumber > 0) {
            multi.sAdd(rGameKey(broadcastId).question(gameInfo.questionNumber).roundEliminated, playerId);
        }
    });

    await multi.exec();

    const eliminatedUsers = await bulkGetUsers(playersToEliminate.map(plrId => +plrId));
    eliminatedUsers.forEach(usr => {
        sendFriends({ playerId: usr.id.toString(), broadcastId }, constructViewerUpdate(usr, 'watching'));
    });

    await CrossServer.sendAllServers('eliminated', broadcastId, { playerIds: playersToEliminate });
    
    sendProducerPlayerList(broadcastId).catch(err => logger.error('Failed to send producer player list after elimination', err));
}

export default masterEliminateHandler;

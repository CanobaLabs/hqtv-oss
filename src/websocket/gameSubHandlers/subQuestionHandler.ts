import logger from '../../common/logger';
import constructBroadcastStats from '../constructors/constructBroadcastStats';
import constructQuestion from '../constructors/constructQuestion';
import constructStartRound from '../constructors/constructStartRound';
import getGameInfo from '../helpers/getGameInfo';
import { wsServers } from '../wsServers';

async function subQuestionHandler(broadcastId: number) {
    const gameInfo = await getGameInfo(broadcastId);
    const { gameType } = gameInfo;
    
    if (gameType === 'trivia') {
        wsServers[broadcastId]?.wss.bulkSend(constructQuestion(gameInfo, true));
    } else if (gameType === 'words') {
        await wsServers[broadcastId]?.wss.bulkSend(constructStartRound(gameInfo, true));
        setTimeout(async () => {
            try {
                wsServers[broadcastId]?.wss.sendAll(await constructBroadcastStats(broadcastId));
            } catch (err) {
                logger.error({ err, broadcastId }, 'Error in subQuestionHandler setTimeout');
            }
        }, 200);
    }
}

export { subQuestionHandler };

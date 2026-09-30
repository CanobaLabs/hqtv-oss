import constructGameSummary from '../constructors/constructGameSummary';
import constructWordsGameResult from '../constructors/constructWordsGameResult';
import getGameInfo from '../helpers/getGameInfo';
import { wsServers } from '../wsServers';

async function subWinnersHandler(broadcastId: number) {
    const wss = wsServers[broadcastId]?.wss;
    const gameInfo = await getGameInfo(broadcastId);
    const { gameType } = gameInfo;
    if (gameType === 'trivia') {
        wss?.bulkSend(constructGameSummary(gameInfo));
    } else if (gameType === 'words') {
        wss?.bulkSend(constructWordsGameResult(gameInfo));
    }
}

export { subWinnersHandler };

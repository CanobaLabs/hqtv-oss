import redis from '../../common/redisClient';
import { bulkGetUsers } from '../../common/utils/userGetters';
import levelFromPoints from '../../common/utils/levelFromPoints';
import constructEndRound from '../constructors/constructEndRound';
import constructLeveledUp from '../constructors/constructLeveledUp';
import constructQuestionSummary from '../constructors/constructQuestionSummary';
import constructViewerEvent from '../constructors/constructViewerEvent';
import getFriendIdsAsStr from '../helpers/getFriendIdsAsStr';
import getGameInfo from '../helpers/getGameInfo';
import rGameKey from '../wsTypes/redisGameKeys';
import { wsServers } from '../wsServers';
import getSeason from '../../api/utils/getSeason';

async function subQuestionResultsHandler(broadcastId: number) {
    const gameInfo = await getGameInfo(broadcastId);
    const season = gameInfo.seasonEnabled ? await getSeason() : null;
    
    wsServers[broadcastId]?.wss.clients.forEach(async c => {
        const currentXpStr = await redis.hGet(rGameKey(broadcastId).totalSeasonXp, c.playerId);
        const roundPointsStr = await redis.hGet(rGameKey(broadcastId).question(+gameInfo.questionNumber).pointsEarned, c.playerId);
        if (season && currentXpStr && roundPointsStr) {
            // earned points this round - prevents repeat 'leveled up' messages
            const currentXp = +currentXpStr;
            const prevXp = currentXp - +roundPointsStr;
            const { level: currLevelNumber } = levelFromPoints(currentXp, season.levels);
            const { level: prevLevelNumber } = levelFromPoints(prevXp, season.levels);
            if (currLevelNumber !== prevLevelNumber) {
                c.sendGameClient(constructLeveledUp(currLevelNumber));
            }
        }
        
        const friendIds = await getFriendIdsAsStr(c.playerId);
        if (friendIds.length > 0) {
            const wereFriendsJustEliminated = await redis.smIsMember(rGameKey(broadcastId).question(+gameInfo.questionNumber).roundEliminated, friendIds);
            const eliminatedFriendIds: string[] = [];
            wereFriendsJustEliminated.forEach((elim, i) => {
                const friendId = friendIds[i];
                if (elim) eliminatedFriendIds.push(friendId);
            });
            const eliminatedCount = eliminatedFriendIds.length;
            if (eliminatedCount > 0) {
                const elimUsers = await bulkGetUsers(eliminatedFriendIds.map(plrId => +plrId));
                const elimUserNames: string[] = elimUsers.map(usr => usr.dispName);
                
                let message = '';
                const [user1, user2] = elimUserNames;
                if (eliminatedCount === 1) {
                    // e.g. John was eliminated.
                    message = `${user1} was eliminated.`;
                } else if (eliminatedCount === 2) {
                    // e.g. John and Jane were eliminated.
                    message = `${user1} and ${user2} were eliminated.`;
                } else {
                    const emitCount = eliminatedCount - 2;
                    // e.g. John, Jane, and 1 other friend was eliminated.
                    message = `${user1}, ${user2}, and ${emitCount} other ${emitCount === 1 ? 'friend was' : 'friends were'} eliminated.`;
                }
                c.sendGameClient(constructViewerEvent(message, 'eliminated', elimUserNames));
            }
        }
    });

    const { gameType } = gameInfo;
    if (gameType === 'trivia') {
        wsServers[broadcastId]?.wss.bulkSend(constructQuestionSummary(gameInfo));
    } else if (gameType === 'words') {
        wsServers[broadcastId]?.wss.bulkSend(constructEndRound(gameInfo));
    }
}

export { subQuestionResultsHandler };

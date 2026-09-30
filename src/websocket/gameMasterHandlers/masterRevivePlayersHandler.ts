import redis from '../../common/redisClient';
import { bulkGetUsers } from '../../common/utils/userGetters';
import DiscordPrompt from '../wsTypes/DiscordPrompt';
import constructShowToast from '../constructors/constructShowToast';
import constructViewerUpdate from '../constructors/constructViewerUpdate';
import { getPuzzle } from '../helpers/gameDataGetters';
import sendDiscordPrompter from '../helpers/sendDiscordPrompter';
import { sendFriends } from '../helpers/playerMethods';
import rGameKey from '../wsTypes/redisGameKeys';
import WsGameInfo from '../wsTypes/WsGameInfo';
import CrossServer from '../helpers/CrossServer';
import sendProducerPlayerList from '../helpers/sendProducerPlayerList';
import logger from '../../common/logger';

async function masterRevivePlayersHandler(gameInfo: WsGameInfo, broadcastId: number, playerGroup: 'all' | 'justEliminated' | string | string[]) {
    const currentPuzzle = await getPuzzle(broadcastId);
    async function revive(playerIds: string[], discordLabel?: string) {
        const multi = redis.multi();
        const bulkInTheGame = await redis.smIsMember(rGameKey(broadcastId).inTheGame, playerIds);
        const notInTheGamePlrIds = playerIds.flatMap((id, i) => !bulkInTheGame[i] ? id : []);
        notInTheGamePlrIds.forEach(plrId => {
            multi.sRem(rGameKey(broadcastId).eliminated, plrId);
            multi.sAdd(rGameKey(broadcastId).inTheGame, plrId);
            multi.sAdd(rGameKey(broadcastId).question(+gameInfo.questionNumber).savedByStaff, plrId);
            if (currentPuzzle) {
                multi.hDel(rGameKey(broadcastId).playerStrikes, plrId); // reset strikes
                multi.hIncrBy(rGameKey(broadcastId).totalSolveTime, plrId, +currentPuzzle.totalTimeMs);
            }
        });
        await multi.exec();
        if (notInTheGamePlrIds.length > 0) {
            const notInTheGameUsers = await bulkGetUsers(notInTheGamePlrIds.map(plrId => +plrId));
            notInTheGameUsers.forEach(usr => {
                sendFriends({ playerId: usr.id.toString(), broadcastId }, constructViewerUpdate(usr, 'playing'));
            });
        }
        
        const alreadyUsedLife = await redis.smIsMember(rGameKey(broadcastId).question(+gameInfo.questionNumber).usedLife, playerIds);
        const alreadyUsedLifePlrIds = playerIds.flatMap((id, i) => alreadyUsedLife[i] ? id : []);
        const reverseLifeMulti = redis.multi();
        alreadyUsedLifePlrIds.forEach(plrId => {
            reverseLifeMulti
                .hIncrBy(rGameKey(broadcastId).livesUsed, plrId, -1)
                .sRem(rGameKey(broadcastId).question(+gameInfo.questionNumber).usedLife, plrId)
        });
        await reverseLifeMulti.exec();
        await CrossServer.sendAllServers('sendPlayers', broadcastId, { playerIds: alreadyUsedLifePlrIds, payload: constructShowToast('Your extra life has been returned', process.env.CDN_URL + '/hqtv/revived.png') });

        const allRevivedPlrIds = [...notInTheGamePlrIds, ...alreadyUsedLifePlrIds];
        await CrossServer.sendAllServers('sendPlayers', broadcastId, { playerIds: allRevivedPlrIds, payload: constructShowToast('We have brought you back into the game.', process.env.CDN_URL + '/hqtv/revived.png') });
        
        // Commented out for trivia games (except game start/end)
        // if (discordLabel && allRevivedPlrIds.length > 0 && gameInfo.gameType === 'trivia') {
        //     sendDiscordPrompter([
        //         new DiscordPrompt(gameInfo, 'now', discordLabel)
        //             .revived(allRevivedPlrIds.length)
        //     ]);
        // }
    }
    
    if (playerGroup === 'all') {
        const allPlayerIds = await redis.sMembers(rGameKey(broadcastId).joinedPlayers);
        await revive(allPlayerIds, 'Revived everyone');
    } else if (playerGroup === 'justEliminated') {
        const justEliminatedPlrIds = await redis.sMembers(rGameKey(broadcastId).question(+gameInfo.questionNumber).roundEliminated);
        await revive(justEliminatedPlrIds, 'Revived question eliminated');
    } else if (Array.isArray(playerGroup)) {
        await revive(playerGroup);
    } else {
        await revive([playerGroup]);
    }
    await CrossServer.sendAllServers('revived', broadcastId);
    // Send player list update to producers after revivals
    sendProducerPlayerList(broadcastId).catch(err => logger.error('Failed to send producer player list after revivals', err));
    return { revived: await redis.sMembers(rGameKey(broadcastId).question(+gameInfo.questionNumber).savedByStaff) };
}

export default masterRevivePlayersHandler;

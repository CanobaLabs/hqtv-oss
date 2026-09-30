import redis from '../../common/redisClient';
import getGameInfo from '../helpers/getGameInfo';
import rGameKey from '../wsTypes/redisGameKeys';

async function getConnectionGameInfo(broadcastId: number, playerId: string, seasonXp: number) {
    const [gameInfo, [broadcastLive, noNewPlayers, joinedBefore]] = await Promise.all([
        getGameInfo(broadcastId),
        redis.multi()
            .exists(rGameKey(broadcastId).gameActiveFlag)
            .exists(rGameKey(broadcastId).noNewPlayersFlag)
            .sIsMember(rGameKey(broadcastId).joinedPlayers, playerId)
            .hSetNX(rGameKey(broadcastId).totalSeasonXp, playerId, seasonXp.toString()) // only set once so it doesn't reset back to their pre-game XP
            .exec() as Promise<[number, number, number]>,
    ]);
    return { gameInfo, broadcastLive, noNewPlayers, joinedBefore };
}

export default getConnectionGameInfo;

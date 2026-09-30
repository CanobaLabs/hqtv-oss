import redis from '../../common/redisClient';
import rGameKey from '../wsTypes/redisGameKeys';
import HqClose from '../wsMessageTypes/HqClose';
import WsGameInfo from '../wsTypes/WsGameInfo';

function constructClose(gameInfo: WsGameInfo) {
    return async function(_: number, playerIds: string[]) {
        const currentState = await redis.get(rGameKey(gameInfo.broadcastId).currentState);
        return playerIds.map(() => {
            return {
                type: currentState,
                showId: gameInfo.gameId,
                roundId: 0,
                questionId: 0
            } as HqClose;
        });
    }
}

export default constructClose;

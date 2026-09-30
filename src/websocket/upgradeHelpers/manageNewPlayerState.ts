import getSeason from '../../api/utils/getSeason';
import redis from '../../common/redisClient';
import levelFromPoints from '../../common/utils/levelFromPoints';
import rGameKey from '../wsTypes/redisGameKeys';
import WsGameInfo from '../wsTypes/WsGameInfo';
import checkpointMethods from '../helpers/CheckpointMethods';

async function manageNewPlayerState(gameInfo: WsGameInfo, playerId: string, seasonXp: number, noNewPlayers: number, joinedBefore: number) {
    const { broadcastId, gameType, questionNumber, seasonEnabled } = gameInfo;
    if (!noNewPlayers && !joinedBefore) {
        // accept new players until the end of Q1
        if (gameType == 'words' && questionNumber > 0) {
            await redis.sAdd(rGameKey(broadcastId).solvingPlayers, playerId);
        } else {
            await redis.sAdd(rGameKey(broadcastId).inTheGame, playerId);
        }
    } else if (gameType == 'trivia' && seasonEnabled) {
        // check for free pass
        const season = await getSeason();
        const { level } = levelFromPoints(seasonXp, season?.levels ?? []);
        if (level >= questionNumber) {
            // check if player has taken a checkpoint (eliminated for rest of game)
            const checkpointIds = await checkpointMethods(broadcastId).getIds();
            const hasTakenCheckpoint = await Promise.all(
                checkpointIds.all.map(cp => redis.hExists(rGameKey(broadcastId).checkpoint(cp.value).prizes, playerId))
            );
            if (!hasTakenCheckpoint.some(Boolean)) {
                await redis.sAdd(rGameKey(broadcastId).inTheGame, playerId);
            }
        }
    }
}

export default manageNewPlayerState;

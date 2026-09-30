import redis from '../../common/redisClient';
import generatePrizeDisplayText from '../helpers/generatePrizeDisplayText';
import rGameKey from '../wsTypes/redisGameKeys';
import WinInfo from '../redisSchemas/winInfo';
import HqWordsGameResult from '../wsMessageTypes/HqWordsGameResult';
import WsGameInfo from '../wsTypes/WsGameInfo';

function constructWordsGameResult(gameInfo: WsGameInfo) {
    return async function(_: number, playerIds: string[]) {
        const { broadcastId, gameId } = gameInfo;
        const [winners, bulkTotalTime] = await Promise.all([
            redis.get(rGameKey(broadcastId).winners).then(e => (e ? JSON.parse(e) : []) as WinInfo[]),
            redis.hmGet(rGameKey(broadcastId).totalSolveTime, playerIds)
        ]);
        const wordsWinners = winners.map(w => ({
            winner: {
                username: w.username,
                avatarUrl: w.avatarUrl,
                userId: w.userId
            },
            rank: w.rank,
            prize: generatePrizeDisplayText(w.prizeCents, w.prizePoints),
            time: w.totalSolveTime
        }));
        
        return playerIds.map((_, i) => {
            const totalTime = +(bulkTotalTime[i] ?? 0);
            return {
                type: 'wordsGameResult',
                showId: gameId,
                winners: wordsWinners,
                numWinners: winners.length,
                totalTime: totalTime
            } as HqWordsGameResult;
        });
    }
}

export default constructWordsGameResult;

import redis from '../../common/redisClient';
import rGameKey from '../wsTypes/redisGameKeys';
import RedisGameInfo from '../redisSchemas/redisGameInfo';
import WsGameInfo from '../wsTypes/WsGameInfo';

async function getGameInfo(broadcastId: number) {
    const r = await redis.hGetAll(rGameKey(broadcastId).gameInfo) as RedisGameInfo;
    return {
        gameId: +r.gameId,
        broadcastId: +r.broadcastId,
        rehearsal: !!+r.rehearsal,
        forReal: !!+r.forReal,
        showType: r.showType,
        gameType: r.gameType,
        startActual: new Date(r.startActual),
        prizeCents: +r.prizeCents,
        prizePoints: +r.prizePoints,
        splitCents: r.splitCents ? !!+r.splitCents : true,
        splitPoints: r.splitPoints ? !!+r.splitPoints : true,
        questionId: r.questionId ? +r.questionId : null,
        questionNumber: +r.questionNumber,
        questionCount: +r.questionCount,
        seasonEnabled: !!+r.seasonEnabled,
        winnersCap: r.winnersCap ? +r.winnersCap : null,
        maxLives: r.maxLives ? +r.maxLives : null,
        maxErasers: r.maxErasers ? +r.maxErasers : null,
        strikeLimit: +r.strikeLimit,
        wheelLetters: r.wheelLetters ? r.wheelLetters : null,
        superWheelItems: r.superWheelItems ? JSON.parse(r.superWheelItems) : [],
        wheelRevealed: !!+(r.wheelRevealed ?? 0),
        chatDisabled: !!+(r.chatDisabled ?? 0)
    } as WsGameInfo;
}

export default getGameInfo;

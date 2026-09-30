import currency from 'currency.js';
import redis from '../../common/redisClient';
import rGameKey from '../wsTypes/redisGameKeys';
import WinInfo from '../redisSchemas/winInfo';
import getKeepPlayingConfig from './getKeepPlayingConfig';
import centsToDollars from '../../common/utils/centsToDollars';
import { bulkGetUsers } from '../../common/utils/userGetters';
import getGameInfo from './getGameInfo';

async function generateWinners(broadcastId: number) {
    const gameInfo = await getGameInfo(broadcastId);
    const winnerIds = await redis.sMembers(rGameKey(broadcastId).inTheGame);
    const winnerCount = winnerIds.length;
    const winnerUsers = await bulkGetUsers(winnerIds.map(plrId => +plrId));
    let winnerSolveTimes: string[] = [];
    if (winnerCount > 0) {
        [winnerSolveTimes] = await Promise.all([
            redis.hmGet(rGameKey(broadcastId).totalSolveTime, winnerIds)
        ]);
    }
    const shouldSplitCents = gameInfo.splitCents ?? true;
    const shouldSplitPoints = gameInfo.splitPoints ?? true;
    const moneyDistribution = shouldSplitCents
        ? (winnerCount > 0
            ? currency(centsToDollars(gameInfo.prizeCents)).distribute(winnerCount)
            .sort(() => Math.random() - 0.5) // shuffle amounts
            .map(prize => +JSON.stringify(prize) * 100)
            : [])
        : Array(winnerCount).fill(gameInfo.prizeCents);
    const pointsDistribution = shouldSplitPoints
        ? (winnerCount > 0
            ? currency(gameInfo.prizePoints).distribute(winnerCount)
                .sort(() => Math.random() - 0.5)
                .map(prize => Math.round(+JSON.stringify(prize)))
            : [])
        : Array(winnerCount).fill(gameInfo.prizePoints);
    
    const winnersInfo: WinInfo[] = [];
    moneyDistribution.forEach((cents, i) => {
        const winUser = winnerUsers[i];
        const totalSolveTime = winnerSolveTimes[i];
        const winInfo = {
            userId: winUser.id,
            username: winUser.dispName,
            avatarUrl: winUser.avatarUrl,
            isPro: winUser.booster,
            prizeCents: cents,
            prizePoints: pointsDistribution[i] ?? 0,
            totalSolveTime: +(totalSolveTime ?? '0')
        } as WinInfo;
        winnersInfo.push(winInfo);
    });
    if (gameInfo.gameType === 'words') {
        winnersInfo.sort((a, b) => +a.totalSolveTime - +b.totalSolveTime); // fastest solver first
    } else if (gameInfo.gameType === 'trivia') {
        const { enabled: kpEnabled, baseCoins, lifeChance, maxLives, eraserChance, maxErasers, consecutiveChanceMulti } = await getKeepPlayingConfig();
        if (kpEnabled) {
            const keepPlayingPlrs = await redis.sMembers(rGameKey(broadcastId).question(gameInfo.questionNumber).roundKeepPlaying);
            async function doo(rKey: string, firstChance: number, max: number) {
                const rMulti = redis.multi();
                keepPlayingPlrs.forEach(plrId => {
                    let currChance = firstChance;
                    let qty = 0;
                    for (let i = 0; i < max; i++) {
                        const result = Math.random();
                        const award = result <= currChance;
                        if (award) {
                            qty += i;
                            currChance *= consecutiveChanceMulti; // odds change for consecutive rolls
                        } else break;
                    }
                    if (qty > 0) {
                        rMulti.hIncrBy(rKey, plrId, qty);
                    }
                });
                await rMulti.exec();
            }
            await doo(rGameKey(broadcastId).keepPlayingRewardLives, lifeChance, maxLives);
            await doo(rGameKey(broadcastId).keepPlayingRewardErasers, eraserChance, maxErasers);
            
            const rMulti = redis.multi();
            keepPlayingPlrs.forEach(plrId => {
                rMulti.hIncrBy(rGameKey(broadcastId).keepPlayingRewardCoins, plrId, baseCoins);
            });
            await rMulti.exec();
        }
        winnersInfo.sort((a, b) => +b.isPro - +a.isPro);
    }

    const winnerMulti = redis.multi()
        .del(rGameKey(broadcastId).winners)
    const wn = winnersInfo.map((winInfo, i) => {
        const rank = i + 1;
        const winInfoWithRank = {
            ...winInfo,
            rank: rank
        } as WinInfo;
        if (winInfo.prizeCents) {
            winnerMulti.hSet(rGameKey(broadcastId).cashWonFromJackPot, winInfo.userId, winInfo.prizeCents);
        }
        if (winInfo.prizePoints) {
            winnerMulti.hSet(rGameKey(broadcastId).pointsWonFromJackPot, winInfo.userId, winInfo.prizePoints);
        }
        return winInfoWithRank;
    });
    await winnerMulti.exec();
    await redis.set(rGameKey(broadcastId).winners, JSON.stringify(wn));
    return winnersInfo;
}

export default generateWinners;

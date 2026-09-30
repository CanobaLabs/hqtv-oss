import redis from '../../common/redisClient';
import generatePrizeDisplayText from '../helpers/generatePrizeDisplayText';
import rGameKey from '../wsTypes/redisGameKeys';
import WinInfo from '../redisSchemas/winInfo';
import HqGameSummary from '../wsMessageTypes/HqGameSummary';
import WsGameInfo from '../wsTypes/WsGameInfo';

function constructGameSummary(gameInfo: WsGameInfo) {
    return async function(_: number, playerIds: string[]) {
        const { broadcastId, gameId, questionNumber } = gameInfo;
        const winRewardsPromises = Promise.all([
            redis.hmGet(rGameKey(broadcastId).cashWonFromJackPot, playerIds),
            redis.hmGet(rGameKey(broadcastId).pointsWonFromJackPot, playerIds)
        ]);
        const keepPlayingRewardsPromises = Promise.all([
            redis.hmGet(rGameKey(broadcastId).keepPlayingRewardCoins, playerIds),
            redis.hmGet(rGameKey(broadcastId).keepPlayingRewardLives, playerIds),
            redis.hmGet(rGameKey(broadcastId).keepPlayingRewardErasers, playerIds)
        ]);
        
        const gotItRightQPromises: Promise<boolean[]>[] = [];
        const usedLifeQPromises: Promise<boolean[]>[] = [];
        const keepPlayingQPromises: Promise<boolean[]>[] = [];
        for (let i = 1; i <= questionNumber; i++) { // go by questionNumber & not questionCount in case not all questions are asked
            gotItRightQPromises.push(redis.smIsMember(rGameKey(broadcastId).question(i).correctOverall, playerIds));
            usedLifeQPromises.push(redis.smIsMember(rGameKey(broadcastId).question(i).usedLife, playerIds));
            keepPlayingQPromises.push(redis.smIsMember(rGameKey(broadcastId).question(i).roundKeepPlaying, playerIds));
        }
        
        const [
            winners, questionIds,
            [bulkMoneyWon, bulkPointsWon],
            [bulkKpCoins, bulkKpLives, bulkKpErasers],
            bulkGotItRightQs, bulkUsedLifeQs, bulkKeepPlayingQs
        ] = await Promise.all([
            redis.get(rGameKey(broadcastId).winners).then(e => (e ? JSON.parse(e) : []) as WinInfo[]),
            redis.lRange(rGameKey(broadcastId).questionIds, 0, questionNumber - 1).then(e => e.map(qIdStr => +qIdStr)),
            winRewardsPromises,
            keepPlayingRewardsPromises,
            Promise.all(gotItRightQPromises),
            Promise.all(usedLifeQPromises),
            Promise.all(keepPlayingQPromises)
        ]);

        const gameSummaryWinners = winners.map(w => ({
            name: w.username,
            id: w.userId,
            avatarUrl: w.avatarUrl,
            isPro: w.isPro,
            prize: generatePrizeDisplayText(w.prizeCents, w.prizePoints),
            wins: 0,
            userPointsMultiplier: null
        }));

        return playerIds.map((_, i) => {
            const moneyWon = bulkMoneyWon[i];
            const pointsWon = bulkPointsWon[i];
            const kpCoins = bulkKpCoins[i];
            const kpLives = bulkKpLives[i];
            const kpErasers = bulkKpErasers[i];

            const hasQuestionData =
                questionNumber > 0 &&
                bulkGotItRightQs.length === questionNumber &&
                bulkUsedLifeQs.length === questionNumber &&
                bulkKeepPlayingQs.length === questionNumber;
            const keepPlayingStartQNum = hasQuestionData
                ? bulkKeepPlayingQs.findIndex(massKp => massKp?.[i])
                : -1;
            const gotToQuestionNumber = keepPlayingStartQNum != -1 ? keepPlayingStartQNum : questionNumber; // keep playing : made it all the way
        const won = !!moneyWon || !!pointsWon;
            
            return {
                type: 'gameSummary',
                showId: gameId,
                numWinners: winners.length,
                flags: 1,
                winners: gameSummaryWinners,
                youWon: won,
                yourPrize: generatePrizeDisplayText(+(moneyWon ?? 0), +(pointsWon ?? 0)),
                keepPlayingSummary: !won && hasQuestionData ? {
                    gotToQuestionNumber: gotToQuestionNumber,
                    questionsRight: bulkGotItRightQs.filter(bulkRight => bulkRight?.[i]).length,
                    totalQuestions: questionNumber,
                    answerSummary: questionIds.map((qId, qIndex) => ({
                        questionId: qId,
                        gotItRight: bulkGotItRightQs[qIndex]?.[i] ?? false,
                        usedExtraLife: bulkUsedLifeQs[qIndex]?.[i] ?? false,
                        keepPlaying: bulkKeepPlayingQs[qIndex]?.[i] ?? false
                    })),
                    tk: '',
                    rewards: {
                        coins: kpCoins ? +kpCoins : undefined,
                        extraLives: kpLives ? +kpLives : undefined,
                        erase1s: kpErasers ? +kpErasers : undefined
                    }
                } : null
            } as HqGameSummary;
        });
    }
}

export default constructGameSummary;

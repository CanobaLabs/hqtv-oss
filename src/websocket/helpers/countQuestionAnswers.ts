import { all } from 'better-all';
import redis from '../../common/redisClient';
import { getPuzzle, getQuestion } from './gameDataGetters';
import { getQuestionPoints } from './playerMethods';
import rGameKey from '../wsTypes/redisGameKeys';
import generateWinners from './generateWinners';
import getKeepPlayingConfig from './getKeepPlayingConfig';
import WsGameInfo from '../wsTypes/WsGameInfo';
import { bulkGetUsers } from '../../common/utils/userGetters';
import getSeason from '../../api/utils/getSeason';
import sendProducerPlayerList from './sendProducerPlayerList';
import logger from '../../common/logger';

async function countQuestionAnswers(gameInfo: WsGameInfo) {
    const { gameType, broadcastId, questionNumber } = gameInfo;
    if (questionNumber == 1) {
        await redis.set(rGameKey(broadcastId).noNewPlayersFlag, 1);
    }

    const [season, { coinsPerRightAnswer }] = await Promise.all([
        gameInfo.seasonEnabled ? getSeason() : null,
        getKeepPlayingConfig()
    ]);

    if (gameType === 'trivia') {
        const { question, xpAwardsForCorrect } = await all({
            async question() {
                return (await getQuestion(broadcastId))!;
            },
            async xpAwardsForCorrect() {
                return getQuestionPoints(gameInfo);
            }
        });

        await redis.sDiffStore(rGameKey(broadcastId).question(questionNumber).roundKeepPlaying, [rGameKey(broadcastId).joinedPlayers, rGameKey(broadcastId).inTheGame])
        const correctPlayers: string[] = [];
        const correctKeepPlaying: string[] = [];
        const answerCounts: { [answerId: number]: number; } = {};
        const playerAnswers = await Promise.all(
            question.answers.map(a =>
                redis.zRange(rGameKey(broadcastId).question(+questionNumber).playerAnswers, a.id, a.id, { BY: 'SCORE' })
            )
        );
        const keepPlayingAnswers = await Promise.all(
            question.answers.map(a =>
                redis.zRange(rGameKey(broadcastId).question(+questionNumber).keepPlayingAnswers, a.id, a.id, { BY: 'SCORE' })
            )
        );
        question.answers.forEach((answer, index) => {
            const currentAnswerPlrs = playerAnswers[index];
            answerCounts[answer.id] = currentAnswerPlrs.length;
            if (answer.correct) {
                correctPlayers.push(...currentAnswerPlrs);
                correctKeepPlaying.push(...keepPlayingAnswers[index])
            }
        });

        const correctUsers = await bulkGetUsers(correctPlayers.map(plrIdStr => +plrIdStr));
        const combinedMulti = redis.multi();
        correctUsers.forEach(async usr => {
            const plrId = usr.id.toString();
            const xpAwards = xpAwardsForCorrect(usr.booster);
            combinedMulti.sAdd(rGameKey(broadcastId).question(+questionNumber).correctPlayers, plrId);
            if (gameInfo.seasonEnabled) {
                combinedMulti.hIncrBy(rGameKey(broadcastId).question(+questionNumber).pointsEarned, plrId, xpAwards.total);
                combinedMulti.hIncrBy(rGameKey(broadcastId).sessionPoints, plrId, xpAwards.total);
                combinedMulti.hIncrBy(rGameKey(broadcastId).totalSeasonXp, plrId, xpAwards.total);
            }
        });
        correctKeepPlaying.forEach(plrId => {
            combinedMulti.sAdd(rGameKey(broadcastId).question(+questionNumber).correctKeepPlaying, plrId);
            combinedMulti.hIncrBy(rGameKey(broadcastId).keepPlayingRewardCoins, plrId, coinsPerRightAnswer);
        });
        await combinedMulti.exec();
        await redis.sUnionStore(rGameKey(broadcastId).question(questionNumber).correctOverall, [rGameKey(broadcastId).question(+questionNumber).correctPlayers, rGameKey(broadcastId).question(questionNumber).correctKeepPlaying]);

        await redis.sDiffStore(rGameKey(broadcastId).question(questionNumber).wrongPlayers, [rGameKey(broadcastId).question(questionNumber).roundPlaying, rGameKey(broadcastId).question(questionNumber).correctPlayers]);
        
        if (season) {
            // free pass
            const questionLevel = season.levels.find(l => l.level === +questionNumber);
            const savedBySeasonPass: string[] = [];
            if (questionLevel) {
                // free pass available for this question
                const wronglyAnswered = await redis.sMembers(rGameKey(broadcastId).question(questionNumber).wrongPlayers);
                if (wronglyAnswered.length > 0) {
                    const allPlayerPointsStr = await redis.hmGet(rGameKey(broadcastId).totalSeasonXp, wronglyAnswered);
                    wronglyAnswered.forEach((playerId, i) => {
                        // determine whether player has a free pass for this question
                        const plrPoints = +allPlayerPointsStr[i];
                        if (plrPoints >= questionLevel.minPoints) {
                            savedBySeasonPass.push(playerId);
                        }
                    });
                }
            }
            const freePassMulti = redis.multi();
            if (savedBySeasonPass.length > 0) {
                freePassMulti.sAdd(rGameKey(broadcastId).question(+questionNumber).savedByFreePass, savedBySeasonPass);
            }
            await freePassMulti.exec();
        }
        
        const correctOrSavedByFp = await redis.sUnion([rGameKey(broadcastId).question(questionNumber).correctPlayers, rGameKey(broadcastId).question(questionNumber).savedByFreePass]);
        
        if (gameInfo.winnersCap != null) {
            if (correctOrSavedByFp.length === 0 || correctOrSavedByFp.length > +gameInfo.winnersCap) {
                /*await redisClient.hSet(rKeys.GameInfo, 'questionCount', +questionNumber + 1);
                gameInfo = await getGameInfo();
                wss.clients.forEach(async c => {
                    c.sendGameClient(await constructGameStatus(gameInfo, c));
                });*/
            }
            if (correctOrSavedByFp.length === 0) {
                await redis.sUnionStore(rGameKey(broadcastId).question(questionNumber).savedByWinnersCap, rGameKey(broadcastId).inTheGame); // keep alive
            } else if (correctOrSavedByFp.length <= gameInfo.winnersCap) {
                // winner
                await redis.set(rGameKey(broadcastId).question(questionNumber).reachedWinnersCap, 1);
                await generateWinners(broadcastId);
            }
        }
        
        await redis.multi()
            .set(rGameKey(broadcastId).question(questionNumber).resultsReady, 1)
            .sUnionStore(rGameKey(broadcastId).inTheGame, [rGameKey(broadcastId).question(questionNumber).correctPlayers, rGameKey(broadcastId).question(questionNumber).savedByFreePass, rGameKey(broadcastId).question(questionNumber).savedByWinnersCap])
            .sDiffStore(rGameKey(broadcastId).question(questionNumber).roundEliminated, [rGameKey(broadcastId).question(questionNumber).roundPlaying, rGameKey(broadcastId).inTheGame])
            .sUnionStore(rGameKey(broadcastId).eliminated, [rGameKey(broadcastId).eliminated, rGameKey(broadcastId).question(questionNumber).roundEliminated])
            .exec();

        const [advancingCount, eliminatedCount] = await Promise.all([
            redis.sCard(rGameKey(broadcastId).inTheGame),
            redis.sCard(rGameKey(broadcastId).question(questionNumber).roundEliminated)
        ]);
        await redis.hSet(rGameKey(broadcastId).question(questionNumber).q, Object.entries({
            answerCounts: JSON.stringify(answerCounts),
            advancingCount: advancingCount,
            eliminatedCount: eliminatedCount
        }));
        // Send player list update to producers after eliminations
        sendProducerPlayerList(broadcastId).catch(err => logger.error('Failed to send producer player list after eliminations', err));
        return answerCounts;
    }
    else if (gameType === 'words') {
        const puzzle = (await getPuzzle(broadcastId))!;
        const xpAwardsForCorrect = await getQuestionPoints(gameInfo, puzzle);
        const correctlyAnswered = await redis.sMembers(rGameKey(+broadcastId).inTheGame);
        
        const correctUsers = await bulkGetUsers(correctlyAnswered.map(plrIdStr => +plrIdStr));
        const awardMulti = redis.multi();
        correctUsers.forEach(usr => {
            const plrId = usr.id.toString();
            const xpAwards = xpAwardsForCorrect(usr.booster);
            awardMulti.sAdd(rGameKey(+broadcastId).question(questionNumber).correctPlayers, plrId);
            if (gameInfo.seasonEnabled) {
                awardMulti.hIncrBy(rGameKey(+broadcastId).question(questionNumber).pointsEarned, plrId, xpAwards.total);
                awardMulti.hIncrBy(rGameKey(+broadcastId).question(questionNumber).letterPoints, plrId, xpAwards.letterPoints);
                awardMulti.hIncrBy(rGameKey(+broadcastId).question(questionNumber).timeBonus, plrId, xpAwards.timeBonus);
                awardMulti.hIncrBy(rGameKey(+broadcastId).question(questionNumber).solvedPoints, plrId, xpAwards.correctPoints);
                awardMulti.hIncrBy(rGameKey(+broadcastId).sessionPoints, plrId, xpAwards.total);
                awardMulti.hIncrBy(rGameKey(+broadcastId).totalSeasonXp, plrId, xpAwards.total);
            }
        });
        await awardMulti.exec();

        const correctCount = await redis.sCard(rGameKey(+broadcastId).question(questionNumber).correctPlayers);
        if (gameInfo.winnersCap != null) {
            if (correctCount === 0 || correctCount > gameInfo.winnersCap) {
                /*await redisClient.hSet(rKeys.GameInfo, 'questionCount', +questionNumber + 1);
                gameInfo = await getGameInfo();
                wss.clients.forEach(async c => {
                    c.sendGameClient(await constructGameStatus(gameInfo, c));
                });*/
            }
            if (correctCount === 0) {
                const elimPlrIds = await redis.sUnion([rGameKey(broadcastId).solvingPlayers, rGameKey(broadcastId).question(questionNumber).strikedOut]);
                const elimSolveTimes = await redis.hmGet(rGameKey(broadcastId).totalSolveTime, elimPlrIds);
                const elimSolveTimeInfo = elimSolveTimes.map((timeStr, i) => ({ plrId: elimPlrIds[i], time: +timeStr })).sort((a, b) => b.time - a.time);
                const [fastestSolver] = elimSolveTimeInfo;

                // fastest solver is winner
                const multi = redis.multi();
                multi.set(rGameKey(broadcastId).question(questionNumber).reachedWinnersCap, 1);
                multi.sAdd(rGameKey(+broadcastId).question(questionNumber).savedByWinnersCap, fastestSolver.plrId);
                multi.hIncrBy(rGameKey(broadcastId).totalSolveTime, fastestSolver.plrId, puzzle.totalTimeMs);
                multi.sUnionStore(rGameKey(+broadcastId).inTheGame, [rGameKey(+broadcastId).inTheGame, rGameKey(+broadcastId).question(questionNumber).savedByWinnersCap]);
                await multi.exec();
                await generateWinners(+broadcastId);
            }
        }

        await redis.multi()
            .set(rGameKey(broadcastId).question(questionNumber).resultsReady, 1)
            .sDiffStore(rGameKey(broadcastId).question(questionNumber).roundEliminated, [rGameKey(broadcastId).question(questionNumber).roundPlaying, rGameKey(broadcastId).inTheGame])
            .sUnionStore(rGameKey(broadcastId).eliminated, [rGameKey(broadcastId).eliminated, rGameKey(+broadcastId).question(questionNumber).roundEliminated])
            .exec();
        const wronglyAnswered = await redis.sCard(rGameKey(broadcastId).question(+questionNumber).roundEliminated)
        await redis.hSet(rGameKey(broadcastId).question(questionNumber).q, Object.entries({
            advancingCount: correctlyAnswered.length,
            eliminatedCount: wronglyAnswered
        }));
        // Send player list update to producers after eliminations (words game)
        sendProducerPlayerList(broadcastId).catch(err => logger.error('Failed to send producer player list after eliminations (words)', err));
    }

    return {};
}

export default countQuestionAnswers;

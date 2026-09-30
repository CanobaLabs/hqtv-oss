import HqError from '../../common/hqError';
import redis from '../../common/redisClient';
import { getPuzzle, getQuestion } from '../helpers/gameDataGetters';
import rGameKey from '../wsTypes/redisGameKeys';
import WsGameInfo from '../wsTypes/WsGameInfo';
import replicateQuestionsToRedis from '../helpers/replicateQuestionsToRedis';
import replicatePuzzlesToRedis from '../helpers/replicatePuzzlesToRedis';
import { featureDb } from '../../common/database/connections';
import ms from 'ms';
import updateBroadcastStats from '../helpers/updateBroadcastStats';
import CrossServer from '../helpers/CrossServer';
import sendProducerQuestionStatus from '../helpers/sendProducerQuestionStatus';
import logger from '../../common/logger';

async function masterQuestionHandler(gameInfo: WsGameInfo, broadcastId: number, addQuestion?: { new: [string, [string, boolean][]] | [string, string]; } | { questionId: number; }) {
    const { gameType, questionCount } = gameInfo;
    const nextQuestionNum = gameInfo.questionNumber + 1;
    if (addQuestion) {
        let questionId: number | undefined;
        /*if ('new' in addQuestion) {
            const powerUpEligible = nextQuestionNum < questionCount;
            if (gameType == 'trivia') {
                const [question, answers] = addQuestion.new as [string, [string, boolean][]];
                await featureDb.transaction(async transaction => {
                    const newQuestion = await Question.create({ text: question, lifeEligible: powerUpEligible, eraserEligible: powerUpEligible }, { transaction });
                    questionId = newQuestion.questionId;
                    await QuestionAnswer.bulkCreate(answers.map(([text, correct]) => ({ questionId, text, correct })), { transaction });
                });
            } else if (gameType == 'words') {
                const [hint, answer] = addQuestion.new as [string, string];
                await featureDb.transaction(async transaction => {
                    const newPuzzle = await Puzzle.create({ hint, answer, lifeEligible: powerUpEligible }, { transaction });
                    questionId = newPuzzle.roundId;
                });
            }
        } else */ if ('questionId' in addQuestion) {
            questionId = addQuestion.questionId;
        }
        if (questionId != null) {
            if (gameType == 'trivia') await replicateQuestionsToRedis(broadcastId, { questionId: questionId })
            else if (gameType == 'words') await replicatePuzzlesToRedis(broadcastId, { roundId: questionId })
        }
    }
    const questionId = +(await redis.lIndex(rGameKey(broadcastId).questionIds, nextQuestionNum - 1) ?? 0);
    if (!questionId) {
        throw new HqError('All questions have been asked', 0, 400);
    }

    // Mark previous questions as complete and notify producers
    const previousQuestionNumber = gameInfo.questionNumber;
    if (previousQuestionNumber > 0) {
        const questionIds = await redis.lRange(rGameKey(broadcastId).questionIds, 0, -1);
        await Promise.all(questionIds.slice(0, previousQuestionNumber).map(async (prevQId, index) => {
            const questionNum = index + 1;
            const prevQuestion = await getQuestion(broadcastId, questionNum);
            const prevPuzzle = prevQuestion ? null : await getPuzzle(broadcastId, questionNum);
            if ((prevQuestion && prevQuestion.askTime) || (prevPuzzle && prevPuzzle.askTime)) {
                sendProducerQuestionStatus(broadcastId, +prevQId).catch(err => logger.error('Failed to send producer question status for previous question', err));
            }
        }));
    }

    // clone the question as an instance
    await redis.multi()
        .copy(rGameKey(broadcastId).questionModel(questionId), rGameKey(broadcastId).question(nextQuestionNum).q)
        .hSet(rGameKey(broadcastId).question(nextQuestionNum).q, 'askTime', Date.now())
        .sUnionStore(rGameKey(broadcastId).question(nextQuestionNum).roundPlaying, rGameKey(broadcastId).inTheGame)
        .hSet(rGameKey(broadcastId).gameInfo, Object.entries({
            questionId: questionId,
            questionNumber: nextQuestionNum,
            questionCount: Math.max(questionCount, nextQuestionNum)
        }))
        .exec();

    if (gameType == 'trivia') {
        const question = (await getQuestion(broadcastId, nextQuestionNum))!;
        await redis.set(rGameKey(broadcastId).currentState, 'question');
        // Commented out for trivia games (except game start/end)
        // sendDiscordPrompter([
        //     new DiscordPrompt(gameInfo, 'now', `Question started — Q${nextQuestionNum} of ${questionCount}`)
        //         .question(questionId)
        // ]);
        // Commented out for trivia games (except game start/end)
        // DiscordPrompt.questionTimer(gameInfo, question.totalTimeMs);
        await CrossServer.sendAllServers('question', broadcastId);
        sendProducerQuestionStatus(broadcastId, questionId).catch(err => logger.error('Failed to send producer question status', err));
        return question;
    } else if (gameType == 'words') {
        const puzzle = (await getPuzzle(broadcastId, nextQuestionNum))!;
        await redis.multi()
            .set(rGameKey(broadcastId).currentState, 'startRound')
            .sUnionStore(rGameKey(broadcastId).solvingPlayers, rGameKey(broadcastId).inTheGame) // move to solving
            .del(rGameKey(broadcastId).inTheGame)
            .exec();
        await updateBroadcastStats(broadcastId); // fix 1 1 1 playing, solving, eliminated ... the broadcaststats message is sent in the sub handler
        await CrossServer.sendAllServers('question', broadcastId);
        sendProducerQuestionStatus(broadcastId, puzzle.id).catch(err => logger.error('Failed to send producer question status', err));
        return puzzle;
    }
}

export default masterQuestionHandler;

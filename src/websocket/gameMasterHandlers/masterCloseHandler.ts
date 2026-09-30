import HqError from '../../common/hqError';
import redis from '../../common/redisClient';
import countQuestionAnswers from '../helpers/countQuestionAnswers';
import generateWinners from '../helpers/generateWinners';
import rGameKey from '../wsTypes/redisGameKeys';
import WsGameInfo from '../wsTypes/WsGameInfo';
import CrossServer from '../helpers/CrossServer';
import sendProducerQuestionStatus from '../helpers/sendProducerQuestionStatus';
import sendProducerAnswerCount from '../helpers/sendProducerAnswerCount';
import sendProducerWinnersStatus from '../helpers/sendProducerWinnersStatus';
import logger from '../../common/logger';

async function masterCloseHandler(gameInfo: WsGameInfo, broadcastId: number) {
    const currentState = await redis.get(rGameKey(broadcastId).currentState);

    if (currentState === 'question') {
        await redis.set(rGameKey(broadcastId).currentState, 'questionClosed');
        await countQuestionAnswers(gameInfo);
        const questionId = +gameInfo.questionId!;
        sendProducerQuestionStatus(broadcastId, questionId).catch(err => logger.error('Failed to send producer question status', err));
        sendProducerAnswerCount(broadcastId).catch(err => logger.error('Failed to send producer answer count', err));

        // Commented out for trivia games (except game start/end)
        // if (gameInfo.gameType === 'trivia') {
        //     sendDiscordPrompter([
        //         new DiscordPrompt(gameInfo, 'now', 'Question closed').embed,
        //         new DiscordPrompt(gameInfo, 'pre').questionResults(),
        //         new DiscordPrompt(gameInfo, 'pre').winnersCapResult()
        //     ]);
        // }
    } else if (currentState === 'startRound') {
        await redis.set(rGameKey(broadcastId).currentState, 'questionClosed');
        await countQuestionAnswers(gameInfo);
        const questionId = +gameInfo.questionId!;
        sendProducerQuestionStatus(broadcastId, questionId).catch(err => logger.error('Failed to send producer question status', err));
    } else if (currentState === 'questionSummary') {
        await redis.set(rGameKey(broadcastId).currentState, 'questionFinished');
        const questionId = +gameInfo.questionId!;
        sendProducerQuestionStatus(broadcastId, questionId).catch(err => logger.error('Failed to send producer question status', err));
        const inTheGameCount = await redis.sCard(rGameKey(broadcastId).inTheGame);

        const nextQuestionNum = +gameInfo.questionNumber + 1;
        const nextQuestionId = await redis.lIndex(rGameKey(broadcastId).questionIds, nextQuestionNum - 1);
        if (nextQuestionId && (gameInfo.winnersCap == null || inTheGameCount > gameInfo.winnersCap)) {
            const isLastQuestion = gameInfo.winnersCap == null && nextQuestionNum === +gameInfo.questionCount;
            // Commented out for trivia games (except game start/end)
            // if (gameInfo.gameType === 'trivia') {
            //     sendDiscordPrompter([
            //         new DiscordPrompt(gameInfo, 'now', 'Results closed').embed,
            //         new DiscordPrompt(gameInfo, 'pre', `${isLastQuestion ? 'Last' : 'Next'} question... (Q${nextQuestionNum} of ${+gameInfo.questionCount})`)
            //             .question(+nextQuestionId)
            //     ]);
            // }
        } else {
            const winners = await generateWinners(broadcastId);
            // Commented out for trivia games (except game start/end)
            // if (gameInfo.gameType === 'trivia') {
            //     sendDiscordPrompter([
            //         new DiscordPrompt(gameInfo, 'now', 'Results closed').embed,
            //         new DiscordPrompt(gameInfo, 'pre').winners(winners)
            //     ]);
            // }
        }
    } else if (currentState === 'endRound') {
        await redis.set(rGameKey(broadcastId).currentState, 'questionClosed');
        const questionId = +gameInfo.questionId!;
        sendProducerQuestionStatus(broadcastId, questionId).catch(err => logger.error('Failed to send producer question status', err));
        const inTheGameCount = await redis.sCard(rGameKey(broadcastId).inTheGame);

        const nextPuzzleNum = +gameInfo.questionNumber + 1;
        const nextPuzzleId = await redis.lIndex(rGameKey(broadcastId).questionIds, nextPuzzleNum - 1);
        if (nextPuzzleId && (gameInfo.winnersCap == null || inTheGameCount > gameInfo.winnersCap)) {
            // Next puzzle logic
        } else {
            const winners = await generateWinners(broadcastId);
            // Winners logic
        }
    } else if (currentState === 'gameSummary' || currentState === 'wordsGameResult') {
        await redis.set(rGameKey(broadcastId).currentState, 'postGame');
        sendProducerWinnersStatus(broadcastId).catch(err => logger.error('Failed to send producer winners status', err));
        // Commented out for trivia games (except game start/end)
        // if (gameInfo.gameType === 'trivia') {
        //     sendDiscordPrompter([
        //         new DiscordPrompt(gameInfo, 'now', 'Winners closed').embed
        //     ]);
        // }
    } else {
        throw new HqError('There is no open game feature.', 0, 400);
    }

    await CrossServer.sendAllServers('close', broadcastId);
}

export default masterCloseHandler;

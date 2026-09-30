import redis from '../../common/redisClient';
import { getQuestion } from './gameDataGetters';
import getGameInfo from './getGameInfo';
import rGameKey from '../wsTypes/redisGameKeys';
import CrossServer from './CrossServer';
import getSeason from '../../api/utils/getSeason';

async function sendProducerAnswerCount(broadcastId: number) {

    const gameInfo = await getGameInfo(broadcastId);
    const question = await getQuestion(broadcastId);
    
    if (!question || gameInfo.gameType !== 'trivia') {
        return;
    }

    const questionNumber = +gameInfo.questionNumber;
    const answerCounts: { [answerId: number]: number } = {};
    const keepPlayingCounts: { [answerId: number]: number } = {};

    const playerAnswers = await Promise.all(
        question.answers.map(a =>
            redis.zRange(rGameKey(broadcastId).question(questionNumber).playerAnswers, a.id, a.id, { BY: 'SCORE' })
        )
    );

    const keepPlayingAnswers = await Promise.all(
        question.answers.map(a =>
            redis.zRange(rGameKey(broadcastId).question(questionNumber).keepPlayingAnswers, a.id, a.id, { BY: 'SCORE' })
        )
    );

    question.answers.forEach((answer, index) => {
        answerCounts[answer.id] = playerAnswers[index].length;
        keepPlayingCounts[answer.id] = keepPlayingAnswers[index].length;
    });

    let eliminated = 0;
    let saved = 0;

    const correctAnswer = question.answers.find(a => a.correct);
    if (correctAnswer) {
        const getQuestionStatusHelper = (await import('./getQuestionStatus')).default;
        const questionStatus = await getQuestionStatusHelper(broadcastId, question.id);
        const questionFinished = questionStatus === 'explanation' || questionStatus === 'results' || questionStatus === 'complete';

        const allWrongPlayerIds: string[] = [];
        question.answers.forEach((answer, index) => {
            if (!answer.correct) {
                allWrongPlayerIds.push(...playerAnswers[index]);
            }
        });

        const [roundPlaying, correctPlayers] = await Promise.all([
            questionFinished ? redis.sMembers(rGameKey(broadcastId).question(questionNumber).roundPlaying) : Promise.resolve([]),
            questionFinished ? redis.sMembers(rGameKey(broadcastId).question(questionNumber).correctPlayers) : Promise.resolve([])
        ]);

        const correctSet = new Set(correctPlayers);

        let playersToCheck: string[];
        if (questionFinished) {
            playersToCheck = roundPlaying.filter(playerId => !correctSet.has(playerId));
        } else {
            playersToCheck = allWrongPlayerIds;
        }

        if (playersToCheck.length > 0) {
            const savedByFreePassSet = await redis.sMembers(rGameKey(broadcastId).question(questionNumber).savedByFreePass);
            const savedByFreePass = new Set(savedByFreePassSet);
            
            if (savedByFreePassSet.length === 0 && gameInfo.seasonEnabled) {
                const season = await getSeason();
                const questionLevel = season?.levels.find(l => l.level === questionNumber);
                if (questionLevel) {
                    const allPlayerPointsStr = await redis.hmGet(rGameKey(broadcastId).totalSeasonXp, playersToCheck);
                    playersToCheck.forEach((playerId, i) => {
                        const plrPoints = +allPlayerPointsStr[i];
                        if (plrPoints >= questionLevel.minPoints) {
                            savedByFreePass.add(playerId);
                        }
                    });
                }
            }

            playersToCheck.forEach(playerId => {
                if (savedByFreePass.has(playerId)) {
                    saved++;
                } else {
                    eliminated++;
                }
            });
        }
    }

    const countMessage = {
        type: 'count',
        questionId: question.id,
        questionNumber: questionNumber,
        answerCounts: answerCounts,
        keepPlayingCounts: keepPlayingCounts,
        eliminated: eliminated,
        saved: saved
    };

    await CrossServer.sendAllServers('producerMessage', broadcastId, { message: countMessage });
}

export default sendProducerAnswerCount;


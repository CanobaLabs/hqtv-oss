import { v4 as uuidv4 } from 'uuid';
import HqError from '../../common/hqError';
import redis from '../../common/redisClient';
import getOffairTriviaConfig from '../utils/getOffairTriviaConfig';
import OffairTriviaStatus from '../responseTypes/offairTrivia/OffairTriviaStatus';
import User from '../../common/types/user';
import OffairTriviaStartQuestion from '../responseTypes/offairTrivia/OffairTriviaStartQuestion';
import getSeason from '../utils/getSeason';
import ms from 'ms';
import OffairTriviaGameSummary from '../responseTypes/offairTrivia/OffairTriviaGameSummary';
import CompletedOffairGame from '../../common/database/userModels/completedOffairGame';
import adjustItemBalance from '../../common/utils/adjustItemBalance';
import levelFromPoints from '../../common/utils/levelFromPoints';
import OffairTriviaAnswerResults from '../responseTypes/offairTrivia/OffairTriviaAnswerResults';
import rKey from '../../common/redisKeys';
import OffairTriviaStartGame from '../responseTypes/offairTrivia/OffairTriviaStartGame.ts';
import OffairQuestion from '../../common/database/featureModels/offairQuestion';
import OffairAnswer from '../../common/database/featureModels/offairAnswer';
import getGeneralConfig from '../utils/getGeneralConfig';
import { LbMode } from '../../common/enums';

export async function getGameStatus(gameUuid: string) {
    const gameStatus = await redis.hGetAll(rKey.offairTriviaGameStatus(gameUuid));
    const currQuestionObject = JSON.parse(gameStatus.currentQuestion);
    let game: {
        started: number;
        status: OffairTriviaStatus;
        questionNumber: number;
        questionCount: number;
        currentQuestion: { questionId: string; askTime: number; submittedAnswerId: unknown; correctAnswer: boolean; pointsEarned: number; coinsEarned: number; };
        answerResults: boolean[];
        totalPointsEarned: number;
        totalCoinsEarned: number;
    } = {
        started: +gameStatus.started,
        status: gameStatus.status as OffairTriviaStatus,
        questionNumber: +gameStatus.questionNumber,
        questionCount: +gameStatus.questionCount,
        currentQuestion: {
            questionId: currQuestionObject.questionId,
            askTime: currQuestionObject.askTime ?? 0,
            submittedAnswerId: currQuestionObject.submittedAnswerId ?? null,
            correctAnswer: currQuestionObject.correctAnswer ?? false,
            pointsEarned: currQuestionObject.pointsEarned ?? 0,
            coinsEarned: currQuestionObject.coinsEarned ?? 0
        },
        answerResults: JSON.parse(gameStatus.answerResults ?? '[]'),
        totalPointsEarned: +gameStatus.totalPointsEarned,
        totalCoinsEarned: +gameStatus.totalCoinsEarned
    }
    return game;
}

export async function getOutwardsGame(userId: number) {
    const gameUuid = await redis.get(rKey.offairTriviaGameUuid(userId));
    if (gameUuid) {
        const { status, questionNumber, questionCount, answerResults } = await getGameStatus(gameUuid);
        const response: OffairTriviaStartGame = {
            gameUuid,
            status,
            questionNumber,
            questionCount,
            answerResults,
            category: '',
            reminders: []
        }
        return response;
    }
}

export async function getWaitTimeToNextGame(userId: number) {
    const nextGameAtStr = await redis.get(rKey.offairTriviaCooldown(userId));
    const nextGameAt = +(nextGameAtStr ?? '0');
    return Math.max(0, nextGameAt - Date.now());
}

export async function getRandomQuestionId() {
    const dbCount = await OffairQuestion.count(); // helps determine a random search point
    const randQuestion = await OffairQuestion.findOne({ // select a sample then pick from it ... order by: rand() too slow
        attributes: ['offairQuestionId'],
        offset: Math.floor(Math.random() * dbCount)
    }) as { offairQuestionId: number };
    return [randQuestion.offairQuestionId, dbCount];
}

export async function getQuestionAndAnswers(questionId: string | number) {
    const [question, answers] = await Promise.all([
        OffairQuestion.findOne({ where: { offairQuestionId: questionId }}),
        OffairAnswer.findAll({ where: { offairQuestionId: questionId }})
    ]);
    return {
        question: question!,
        answers: answers.map(a => ({
            offairAnswerId: a.offairAnswerId.toString(),
            text: a.text,
            correct: !!a.correct
        }))
    }
}

export async function startGame(userId: number) {
	// new game
	const now = Date.now();
    const [hasGameInProgress, cooldown, lockAcquired, offairConfig, generalConfig] = await Promise.all([
        redis.exists(rKey.offairTriviaGameUuid(userId)),
        getWaitTimeToNextGame(userId),
        getGeneralConfig().then(c => redis.set(rKey.offairTriviaLock(userId), 1, { NX: true, EX: c.offairTriviaLockExpirySec })),
        getOffairTriviaConfig(),
        getGeneralConfig()
    ]);

    if (!offairConfig.enabled) {
        throw new HqError('daily challenge disabled', 0, 400);
    }

    if (hasGameInProgress) {
        throw new HqError('user has game in progress', 0, 400);
    }
    if (cooldown > 0) {
        throw new HqError('new game not ready', 0, 400);
    }
    if (!lockAcquired) {
        // race condition
        throw new HqError('please try again', 0, 400);
    }
    
    const newGameUuid = uuidv4();
    const [firstQuestionId] = await getRandomQuestionId();
    await redis.multi()
        .set(rKey.offairTriviaGameUuid(userId), newGameUuid)
        .hSet(rKey.offairTriviaGameStatus(newGameUuid), Object.entries({
            userId: userId,
            started: now,
            status: 'start_game' as OffairTriviaStatus,
            questionNumber: 1,
            questionCount: offairConfig.questionCount,
            currentQuestion: JSON.stringify({ questionId: firstQuestionId })
        }))
        .exec();
    
    const game = await getOutwardsGame(userId);
    return {
        ...game,
        reminders: [{
            sendMs: ms(`${generalConfig.offairTriviaReminderSendHours} hours`),
            message: 'Finish your Daily Challenge now. Just a few more questions to win rewards!'
        }]
    }
}

export async function question(userErasers: number, gameUuid: string = '') {
	const now = Date.now();
	const { questionNumber, questionCount, currentQuestion } = await getGameStatus(gameUuid);
    const { questionId, askTime } = currentQuestion;
    const { question, answers } = await getQuestionAndAnswers(questionId);
    const offairConfig = await getOffairTriviaConfig();

    if (!offairConfig.enabled) {
        throw new HqError('daily challenge disabled', 0, 400);
    }

    let timeLeftMs;
    if (askTime) {
        // resume question
        const timeElapsed = now - askTime;
        timeLeftMs = question.totalTimeMs - timeElapsed;
    } else {
        // new question
        timeLeftMs = question.totalTimeMs;
        const questionObjectWithAskTime = { questionId, askTime: now };
        await redis.multi()
            .hSet(rKey.offairTriviaGameStatus(gameUuid), 'status', 'question_open' as OffairTriviaStatus)
            .hSet(rKey.offairTriviaGameStatus(gameUuid), 'currentQuestion', JSON.stringify(questionObjectWithAskTime))
            .exec();
    }

    const response: OffairTriviaStartQuestion = {
        gameUuid: gameUuid,
        questionCount,
        question: {
            question: question.question,
            answers: answers.map(a => ({ offairAnswerId: a.offairAnswerId, text: a.text })),
            questionNumber,
            totalTimeMs: question.totalTimeMs,
            timeLeftMs: Math.max(0, timeLeftMs),
            erase1: false
        },
        erase1s: userErasers
    }
    return response;
}

export async function submitAnswer(user: User, gameUuid: string = '', inputAnswerId: unknown) {
	const now = Date.now();
	const submittedAnswerId = (inputAnswerId ?? '').toString();
    const { currentQuestion, answerResults } = await getGameStatus(gameUuid);
    const { questionId, askTime } = currentQuestion;
    const { question, answers } = await getQuestionAndAnswers(questionId);
    const offairConfig = await getOffairTriviaConfig();
    const season = await getSeason();

    let correctAnswer = false;
    let roundPointsEarned = 0, roundCoinsEarned = 0;

    if (!offairConfig.enabled) {
        throw new HqError('daily challenge disabled', 0, 400);
    }

    const generalConfig = await getGeneralConfig();
    
    if (submittedAnswerId != null) {
        // answered
        const timeElapsed = now - askTime;
        const questionTimeWithTolerance = question.totalTimeMs + ms(`${generalConfig.offairTriviaQuestionTimeToleranceSec} seconds`);
        if (timeElapsed < questionTimeWithTolerance) {
            // in time
            const playerAnswer = answers.find(a => a.offairAnswerId === submittedAnswerId);
            if (!playerAnswer) {
                throw new HqError('invalid answer', 0, 400);
            }
            correctAnswer = playerAnswer.correct;
        }
    }
    const lockAcquired = await redis.set(rKey.offairTriviaLock(user.id), 1, { NX: true, EX: generalConfig.offairTriviaLockExpirySec });
    if (!lockAcquired) {
        throw new HqError('already answered', 0, 400);
    }
    const pointsMultiplier = user.booster ? 1.5 : 1;
    if (correctAnswer) {
        if (season) {
            roundPointsEarned = offairConfig.correctPoints*pointsMultiplier;
        }
        roundCoinsEarned = offairConfig.correctCoins*pointsMultiplier;
    }

    const updatedQuestionObject = {
        questionId: currentQuestion.questionId,
        askTime: currentQuestion.askTime,
        submittedAnswerId: submittedAnswerId ?? null,
        correctAnswer,
        pointsEarned: roundPointsEarned,
        coinsEarned: roundCoinsEarned
    }
    const newAnswerResults = [...answerResults, correctAnswer];
    await redis.multi()
        .hSet(rKey.offairTriviaGameStatus(gameUuid), 'status', 'question_answered' as OffairTriviaStatus)
        .hSet(rKey.offairTriviaGameStatus(gameUuid), 'currentQuestion', JSON.stringify(updatedQuestionObject))
        .hSet(rKey.offairTriviaGameStatus(gameUuid), 'answerResults', JSON.stringify(newAnswerResults))
        .hIncrBy(rKey.offairTriviaGameStatus(gameUuid), 'totalPointsEarned', roundPointsEarned)
        .hIncrBy(rKey.offairTriviaGameStatus(gameUuid), 'totalCoinsEarned', roundCoinsEarned)
        .exec();
    const updatedGameStatus = await getGameStatus(gameUuid);
    const { questionNumber, questionCount, currentQuestion: currentQuestionNew, answerResults: answerResultsNew, totalPointsEarned, totalCoinsEarned } = updatedGameStatus;
    let nextQuestion: { category: string; nativeAdDurationMs: number | null; } | null = null;
    let gameSummary: OffairTriviaGameSummary | null = null;
    if (questionNumber < questionCount) {
        // another question after
        const [nextQuestionId] = await getRandomQuestionId();
        await redis.multi()
            .hIncrBy(rKey.offairTriviaGameStatus(gameUuid), 'questionNumber', 1)
            .hSet(rKey.offairTriviaGameStatus(gameUuid), 'currentQuestion', JSON.stringify({ questionId: nextQuestionId }))
            .exec();
        nextQuestion = { category: '', nativeAdDurationMs: null };
    } else {
        // end of game
        const questionsCorrect = answerResultsNew.filter(correct => correct).length;
        const questionsIncorrect = answerResultsNew.filter(correct => !correct).length;
        
        const pointsMultiplier = user.booster ? 1.5 : 1;

        // 40 coin completion bonus
        if (questionsIncorrect == 0) await redis.hIncrBy(rKey.offairTriviaGameStatus(gameUuid), 'totalCoinsEarned', offairConfig.completionCoins*pointsMultiplier);

        const NEXT_GAME_WAIT = ms(`${user.booster ? offairConfig.nextGameWaitSecBooster : offairConfig.nextGameWaitSec} seconds`);
        const nextGameAt = now + NEXT_GAME_WAIT;
        await Promise.all([
            redis.multi() // apply cooldown
                .del(rKey.offairTriviaGameUuid(user.id))
                .set(rKey.offairTriviaCooldown(user.id), nextGameAt, { PXAT: nextGameAt })
                .pfAdd(`offairTrivia:usage`, user.id.toString())
                .del(rKey.offairTriviaGameStatus(gameUuid)) // cleanup
                .exec(),
            CompletedOffairGame.create({
                gameUuid,
                userId: user.id,
                started: updatedGameStatus.started,
                pointsEarned: totalPointsEarned,
                coinsEarned: totalCoinsEarned,
                questionCount,
                questionsCorrect,
                questionsIncorrect
            }),
            adjustItemBalance([user.id], {
                seasonXp: totalPointsEarned,
                coins: totalCoinsEarned
            }, { reason: 'offairTrivia'}),
            // Invalidate weekly leaderboard cache so it updates with new daily challenge data
            redis.del(`leaderboard:${LbMode.Week}`)
        ]);

        let pointsInfo = null;
        const season = await getSeason();
        if (season) {
            const currentPoints = user.seasonXp + totalPointsEarned;
            const userLevel = levelFromPoints(currentPoints, season.levels);
            pointsInfo = {
                currentLevelNumber: userLevel.level,
                currentPoints,
                name: season.seasonName,
                remainingPoints: Math.max(0, userLevel.maxPoints - currentPoints)
            }
        }
        gameSummary = {
            pointsEarned: totalPointsEarned,
            coinsEarned: totalCoinsEarned,
            coinsTotal: user.coins + totalCoinsEarned,
            pointsInfo: null, // till figured out
            powerups: {
                unlocks: 0,
                'offair-10x-pts-multi': 0,
                OFFAIR_PTS_MULTI_10: 0,
                'offair-unlock': 0,
                OFFAIR_UNLOCK: 0
            },
            questionsCorrect,
            questionsIncorrect,
            reminders: [],
            showAdToUnlock: false,
            waitTimeMs: NEXT_GAME_WAIT
        }
    }
    const response: OffairTriviaAnswerResults = {
        seasonXp: null,
        pointsEarned: currentQuestionNew.pointsEarned,
        coinsEarned: currentQuestionNew.coinsEarned,
        youGotItRight: currentQuestionNew.correctAnswer,
        answerCounts: answers.map(a => ({ offairAnswerId: a.offairAnswerId, answer: a.text, correct: a.correct })),
        yourOffairAnswerId: currentQuestionNew.submittedAnswerId,
        questionNumber,
        answerResults: answerResultsNew,
        nextQuestion,
        showAd: false,
        gameSummary
    }
    return response;
}

export async function getCompletedGameResults(userIdStr: string) {
    const completedGames = await CompletedOffairGame.findAll({
        where: { userId: userIdStr },
        order: [ ['finished', 'DESC'] ]
    });
    return completedGames;
}

import ms from 'ms';
import redis from '../../common/redisClient';
import rGameKey from '../wsTypes/redisGameKeys';
import WsQuestion from '../wsTypes/WsQuestion';
import WsPuzzle from '../wsTypes/WsPuzzle';
import RedisPuzzle from '../redisSchemas/redisPuzzle';
import RedisQuestion from '../redisSchemas/redisQuestion';

export async function getCurrentQuestionNum(broadcastId: number) {
    return +(await redis.hGet(rGameKey(broadcastId).gameInfo, 'questionNumber') ?? 0);
}

export async function getQuestion(bcastId: number, specificQNum?: number): Promise<WsQuestion | null> {
    const qNum = specificQNum ?? await getCurrentQuestionNum(bcastId);
    const q = await redis.hGetAll(rGameKey(bcastId).question(qNum).q) as RedisQuestion;
    if (Object.keys(q).length == 0) {
        return null;
    }
    if (!q.answers) {
        return null;
    }
    return {
        id: +q.id,
        totalTimeMs: +q.totalTimeMs,
        question: q.question,
        answers: JSON.parse(q.answers),
        media: q.media ? JSON.parse(q.media) : null,
        lifeEligible: !!+q.lifeEligible,
        eraserAnswerId: q.eraserAnswerId ? +q.eraserAnswerId : null,
        askTime: q.askTime ? +q.askTime : null,
        answerCounts: q.answerCounts ? JSON.parse(q.answerCounts) : null,
        advancingCount: q.advancingCount ? +q.advancingCount : null,
        eliminatedCount: q.eliminatedCount ? +q.eliminatedCount : null
    } as WsQuestion;
}

export async function getPuzzle(bcastId: number, specificPNum?: number) {
    const pNum = specificPNum ?? await getCurrentQuestionNum(bcastId);
    const p = await redis.hGetAll(rGameKey(bcastId).question(pNum).q) as RedisPuzzle;
    if (Object.keys(p).length == 0) {
        return null;
    }
    return {
        id: +p.id,
        totalTimeMs: +p.totalTimeMs,
        hint: p.hint,
        answer: p.answer,
        lifeEligible: !!+p.lifeEligible,
        revealedLetters: p.revealedLetters,
        askTime: p.askTime ? +p.askTime : null,
        advancingCount: p.advancingCount ? +p.advancingCount : null,
        eliminatedCount: p.eliminatedCount ? +p.eliminatedCount : null,
        resultsRevealed: !!+(p.resultsRevealed ?? 0)
    } as WsPuzzle;
}

export function getQuestionTimeLeft(totalTimeMs: number, askTime: number) {
    const timeElapsed = Date.now() - askTime;
    const timeLeftMs = totalTimeMs - timeElapsed;
    return Math.max(0, timeLeftMs);
}

export function isQuestionAcceptingAnswers(question: WsQuestion) {
    const answersCloseAt = (question.askTime! + question.totalTimeMs) + ms('2 seconds'); // tolerance
    const isTimeLeft = Date.now() <= answersCloseAt;
    return isTimeLeft && question.answerCounts == null;
}

export function isPuzzleTimeLeft(puzzle: WsPuzzle) {
    const totalTotalTime = +puzzle.totalTimeMs + ms('2 seconds'); // plus time for hint
    const answersCloseAt = (+puzzle.askTime! + totalTotalTime) + ms('2 seconds');
    const isTimeLeft = Date.now() <= answersCloseAt;
    return isTimeLeft;
}

export function getWordsRoundNumber(actualQuestionNum: number) {
    // the app is one ahead so the server needs to send one behind to compensate
    return Math.max(0, actualQuestionNum - 1);
}

import redis from '../../common/redisClient';
import rGameKey from '../wsTypes/redisGameKeys';
import RedisQuestion from '../redisSchemas/redisQuestion';
import { outline } from '../../common/mongoClient';

async function replicateQuestionsToRedis(broadcastId: number, gameIdOrQuestionId: { gameId: number; } | { questionId: number; }, providedOutline?: { outline: any[] }) {
    if ('questionId' in gameIdOrQuestionId) throw new Error('replicateQuestionsToRedis does not support single questionId replication yet');
    const gameOutline = providedOutline ?? (await outline.findOne({ gameId: gameIdOrQuestionId.gameId }) ?? { outline: []});
    const redisQuestions: RedisQuestion[] = gameOutline.outline.filter(o => o.itemType == "question").map(q => {
        const qAnswers = q.answers ?? [];
        const wrongAnswers = qAnswers.filter((a: any) => !a.correct);
        const eraserAnswer = qAnswers.filter((a: any) => a.erase)[0];
        return {
            id: q.id.toString(),
            totalTimeMs: (q.questionLength ?? 10000).toString(),
            question: q.question ?? '',
            answers: JSON.stringify(qAnswers.map((a: any) => ({ id: a.id, text: a.answer, correct: !!a.correct }))),
            lifeEligible: (+(q.lifeEligible ?? true)).toString(),
            eraserAnswerId: eraserAnswer?.id.toString(),
            media: q.media ? JSON.stringify({
                key: q.media?.key ?? '',
                type: q.media?.type ?? '',
                mediaId: q.media?.mediaId ?? '',
                contentType: q.media?.contentType ?? '',
            }) : undefined,
        }
    });

    const multi = redis.multi();
    redisQuestions.forEach(payload => {
        const qKey = rGameKey(broadcastId).questionModel(+payload.id);
        multi.hSet(qKey, Object.entries(payload).filter(([, v]) => v != null));
        if ('gameId' in gameIdOrQuestionId) {
            multi.rPush(rGameKey(broadcastId).questionIds, payload.id);
        } else {
            // adding question
            multi.lPush(rGameKey(broadcastId).questionIds, payload.id);
        }
    });
    await multi.exec();
    
    return redisQuestions;
}

export default replicateQuestionsToRedis;

import ms from 'ms';
import Schedule from '../../../common/database/eventModels/schedule';
import redis from '../../../common/redisClient';
import rKey from '../../../common/redisKeys';
import getSchedule from '../../../api/utils/generateSchedule';
import { outline } from '../../../common/mongoClient';

async function makeScheduleLive(gameId: number, rehearsal: boolean, providedOutline?: { outline: any[] }) {
    const scheduledGame = await Schedule.findOne({ where: { gameId, rehearsal } });
    const roundedTime = new Date(Math.round(new Date().getTime() / ms('5 minutes')) * ms('5 minutes'));
    if (scheduledGame) {
        if (!scheduledGame.startTime) {
            await Schedule.update(
                { startTime: roundedTime },
                { where: { itemId: scheduledGame.itemId }, limit: 1 }
            );
        }
    } else {
        const gameOutline = providedOutline ?? (await outline.findOne({ gameId }) ?? { outline: []});
        const mediaQuestions = gameOutline.outline.filter(o => o.itemType == "question" && o.media);
        await Schedule.create({
            gameId,
            rehearsal,
            startTime: roundedTime,
            visible: true,
            media: (mediaQuestions.length > 0) ? JSON.stringify(mediaQuestions.map(q => {
                return {
                    hash: q.media?.hash ?? '',
                    mediaId: q.media?.mediaId ?? '',
                    mediaUrl: q.media?.mediaUrl ?? '',
                    size: q.media?.size ?? 0,
                }
            })) : undefined,
        });
    }
    // refresh schedule and invalidate cache
    // Parallelize schedule generation and cache invalidation
    await Promise.all([
        getSchedule('normal', true),
        getSchedule('rehearsal', true),
        getSchedule('all', true),
        redis.del(rKey.apGameSchedule(gameId.toString()))
    ]);
}

export default makeScheduleLive;

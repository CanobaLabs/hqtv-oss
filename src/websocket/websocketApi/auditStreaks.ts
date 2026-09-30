import { col, Op } from 'sequelize';
import { userDb } from '../../common/database/connections';
import EndedStreak from '../../common/database/userModels/endedStreak';
import GamePlayed from '../../common/database/userModels/gamesPlayed';
import getStreakConfig from '../../common/utils/getStreakConfig';
import adjustItemBalance from '../../common/utils/adjustItemBalance';
import redis from '../../common/redisClient';
import rGameKey from '../wsTypes/redisGameKeys';
import CurrentStreak from '../../common/database/userModels/currentStreak';
import rKey from '../../common/redisKeys';
import getGameInfo from '../helpers/getGameInfo';

async function auditStreaks(broadcastId: number) {
    const date = new Date();
    const [gameInfo, streakGlobals, streaksAdvancedPlrIds, joinTimes, gamePlays] = await Promise.all([
        getGameInfo(broadcastId),
        getStreakConfig(),
        redis.sMembers(rGameKey(broadcastId).streaksAdvanced),
        redis.hGetAll(rGameKey(broadcastId).joinTime),
        GamePlayed.findAll({
            attributes: ['userId'],
            where: { broadcastId }
        })
    ]);
    const joinedPlayerIds = gamePlays.map(gp => gp.userId);

    let streaksReset = 0, streaksAdvanced = 0, streaksCompleted = 0;
    await userDb.transaction(async transaction => {
        if (streakGlobals.absenseEndsStreak) {
            if (isNaN(gameInfo.questionNumber) || gameInfo.questionNumber > 0) { // if the game actually began (might've had to restart due to tech problem)
                const streaksToEnd = await CurrentStreak.findAll({
                    where: { userId: { [Op.notIn]: joinedPlayerIds } },
                    transaction
                });
                if (streaksToEnd.length > 0) {
                    // clear cache
                    const multi = redis.multi();
                    streaksToEnd.forEach(s => multi.del(rKey.streakInProgress(s.userId)))
                    await multi.exec();
                    const endedStreakRecords = streaksToEnd.map(s => ({
                        streakId: s.streakId,
                        userId: s.userId,
                        target: s.target,
                        actual: s.current,
                        startDate: s.startDate,
                        endDate: date,
                        endReason: 'absent'
                    }));
                    await EndedStreak.bulkCreate(endedStreakRecords, { transaction });
                    streaksReset = await CurrentStreak.destroy({ where: { userId: { [Op.notIn]: joinedPlayerIds } }, transaction });
                }
            }
        }
        
        if (streaksAdvancedPlrIds.length > 0) {
            const newStreakRecords = streaksAdvancedPlrIds.map(plrId => ({
                userId: plrId,
                startDate: joinTimes[plrId] ?? date,
                target: streakGlobals.streakTarget,
                current: 0,
                lastPlayed: joinTimes[plrId] ?? date
            }));
            await CurrentStreak.bulkCreate(newStreakRecords, { updateOnDuplicate: ['lastPlayed'], transaction });
            const [[_, incrementCount]] = await CurrentStreak.increment('current', {
                where: { userId: { [Op.in]: streaksAdvancedPlrIds } },
                by: 1,
                transaction
            });
            streaksAdvanced = incrementCount as unknown as number ?? 0;
        }

        // move completed streaks to ended table and award a life
        const completedStreaks = await CurrentStreak.findAll({
            where: { current: { [Op.eq]: col('target') } },
            transaction
        });
        const completedStreakUserIds = completedStreaks.map(s => s.userId);
        if (completedStreakUserIds.length > 0) {
            await adjustItemBalance(completedStreakUserIds, { lives: 1 }, { reason: 'streak' }, transaction);
            const completedStreakRecords = completedStreaks.map(s => ({
                streakId: s.streakId,
                userId: s.userId,
                target: s.target,
                actual: s.current,
                startDate: s.startDate,
                endDate: date,
                endReason: 'completed'
            }));
            await EndedStreak.bulkCreate(completedStreakRecords, { transaction });
            streaksCompleted = await CurrentStreak.destroy({ where: { current: { [Op.eq]: col('target') } }, transaction });
        }
    });
}

export default auditStreaks;

import { LbMode } from '../../common/enums';
import redis from '../../common/redisClient';
import { Op, col, fn, literal } from 'sequelize';
import Account from '../../common/database/userModels/account';
import logger from '../../common/logger';
import centsToDollars from '../../common/utils/centsToDollars';
import Win from '../../common/database/userModels/win';
import CompletedOffairGame from '../../common/database/userModels/completedOffairGame';
import ms from 'ms';
import ApiLeaderboard from '../responseTypes/ApiLeaderboard';

async function getLeaderboard(mode: LbMode): Promise<ApiLeaderboard> {
    const redisKey = `leaderboard:${mode}`;
    const cachedLeaderboard = await redis.get(redisKey);
    if (cachedLeaderboard) {
        return JSON.parse(cachedLeaderboard);
    } else {
        // generate new leaderboard
        let weekOnly;
        if (mode === LbMode.Week) {
            weekOnly = { winDate: { [Op.gte]: literal('DATE_SUB(NOW(), INTERVAL 1 WEEK)') } };
        }

        let winners: {
            userId: number;
            totalCents: number | string; // type depends on whether alltime or week
            winCount: string;
        }[] = [];
        winners.push(...await Win.findAll({
            attributes: [
                'userId',
                [fn('SUM', col('prizeCents')), 'totalCents'],
                [fn('COUNT', col('*')), 'winCount']
            ],
            group: ['userId'],
            order: [[literal('totalCents'), 'DESC']],
            where: weekOnly,
            limit: 100
        }) as unknown as { // generates fields that aren't part of the model
            userId: number;
            totalCents: number | string; // type depends on whether alltime or week
            winCount: string;
        }[]);

        // Track question counts for daily challenge players
        const questionCounts = new Map<number, number>();
        
        // If weekly leaderboard and no winners (or all winners have $0), show players ranked by daily challenge correct questions
        const hasWinnersWithMoney = winners.some(w => +(w.totalCents as string) > 0);
        if (mode === LbMode.Week && !hasWinnersWithMoney) {
            // Calculate the date one week ago
            const oneWeekAgo = new Date();
            oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
            
            const dailyChallengePlayers = await CompletedOffairGame.findAll({
                attributes: [
                    'userId',
                    [fn('SUM', col('questionsCorrect')), 'totalCorrect']
                ],
                group: ['userId'],
                order: [[literal('totalCorrect'), 'DESC']],
                where: {
                    finished: { [Op.gte]: oneWeekAgo }
                }
            }) as unknown as {
                userId: number;
                totalCorrect: number | string;
            }[];

            // Clear existing winners (they all have $0 anyway) and replace with daily challenge players
            winners = [];
            for (const player of dailyChallengePlayers) {
                const correctCount = +(player.totalCorrect as string);
                // Only include players with valid question counts (greater than 0)
                if (correctCount > 0 && !isNaN(correctCount)) {
                    questionCounts.set(player.userId, correctCount);
                    winners.push({
                        userId: player.userId,
                        totalCents: 0,
                        winCount: '0'
                    });
                }
            }
        } else {
            // Fill remaining spots with random users (for alltime or when there are some winners with money)
            const randomUsers = await Account.findAll({ order: literal('rand()'), limit: 4 })
            for (let i = winners.length; i < 4; i++) {
                // fill empty spots with lucky people!
                const user = randomUsers[i];
                winners.push({
                    userId: user.id,
                    totalCents: 0,
                    winCount: '0'
                });
            }
        }

        // Batch fetch all user accounts to avoid N+1 queries
        const userIds = winners.map(w => w.userId);
        const accounts = await Account.findAll({ where: { id: { [Op.in]: userIds } } });
        const accountMap = new Map(accounts.map(acc => [acc.id, acc]));
        
        const newLeaderboard = winners.map(winner => {
            const user = accountMap.get(winner.userId) ?? null;
            const totalCents = +(winner.totalCents as string);
            const questionCount = questionCounts.get(winner.userId);
            
            // If this is a daily challenge player (has question count), format as "X Questions"
            const total = questionCount !== undefined 
                ? `${questionCount} Questions`
                : centsToDollars(totalCents);
            
            return {
                userId: winner.userId,
                username: user?.name ?? '?',
                avatarUrl: user?.avatarUrl ?? '?',
                total,
                totalCents,
                wins: +winner.winCount
            }
        });
        
        await redis.set(redisKey, JSON.stringify(newLeaderboard), { PX: ms('1 hour') });
        logger.info(`Leaderboard refreshed. Mode=${mode}`);
        return newLeaderboard;
    }
}

export default getLeaderboard;

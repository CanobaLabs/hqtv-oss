import { Transaction } from 'sequelize';
import { userDb } from '../database/connections';
import ItemHistory from '../database/userModels/itemHistory';
import logger from '../logger';
import { bulkCacheUsers } from './userGetters';
import getSeason from '../../api/utils/getSeason';

async function adjustItemBalance(userIds: number[], adjustments: { [currency: string]: number; }, meta: { reason?: string; broadcastId?: number; } = {}, existTransaction?: Transaction) {
    const season = await getSeason();
    const transaction = existTransaction ?? await userDb.transaction();
    const promises = Object.entries(adjustments).flatMap(([item, qty]) => {
        const isSeasonXp = item == 'seasonXp';
        const records = userIds.map(id => ({
            userId: id,
            item,
            qty,
            reason: meta?.reason,
            broadcastId: meta?.broadcastId,
            seasonId: isSeasonXp ? season?.seasonId : null,
            counted: isSeasonXp ? (season ? 1 : 0) : 1
        }));
        return ItemHistory.bulkCreate(records, { transaction });
    });
    if (existTransaction) {
        await Promise.all(promises);
        await bulkCacheUsers(userIds); // refresh users
        logger.info('successfully adjusted balances', { userIds })
    } else {
        try {
            await Promise.all(promises);
            await transaction.commit();
            await bulkCacheUsers(userIds); // refresh users
            logger.info('successfully adjusted balances', { userIds })
        } catch (err) {
            logger.error(err);
            await transaction.rollback();
        }
    }
}

export default adjustItemBalance;

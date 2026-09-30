import ms from 'ms';
import { FindOptions, Transaction } from 'sequelize';
import Payout from '../../common/database/userModels/payout';
import Win from '../../common/database/userModels/win';
import Account from '../../common/database/userModels/account';
import getGeneralConfig from './getGeneralConfig';
import { all } from 'better-all';

async function getBalanceSummary(userId: number, transaction?: Transaction) {
    const lockingOptions: FindOptions = transaction ? { transaction, lock: Transaction.LOCK.UPDATE } : {};
    const { config, wins, payouts, user } = await all({
        async config() { return getGeneralConfig(); },
        async wins() { return Win.findAll({ where: { userId }, order: [['winDate', 'DESC']], ...lockingOptions }); },
        async payouts() { return Payout.findAll({ where: { userId }, ...lockingOptions }); },
        async user() { return Account.findOne({ where: { id: userId } }); }
    });
    
    const forfeitAfter = ms(`${config.winForfeitAfterDays} days`);

    let winsThisWeek = 0;
    let weekTotalCents = 0;

    let prizeTotalCents = 0;
    let unpaidCents = 0;
    let availableCents = 0;
    let paidCents = 0;
    let pendingCents = 0;
    let frozenCents = 0;
    let forfeitedCents = 0;
    let hasPending = false;

    const availableWinIds: number[] = [];
    const frozenWinIds: number[] = [];
    const forfeitedWinIds: number[] = [];
    
    const now = Date.now();
    const lastWeek = now - ms('1 week');
    wins.forEach(w => {
        const winTime = new Date(w.winDate).getTime();
        prizeTotalCents += w.prizeCents;
        if (winTime > lastWeek) {
            winsThisWeek += 1;
            weekTotalCents += w.prizeCents;
        }
        const associatedPayout = payouts.find(p => p.payoutId === w.payoutId);
        if (associatedPayout) {
            if (associatedPayout.paid) {
                paidCents += w.prizeCents;
            } else {
                hasPending = true;
                pendingCents += w.prizeCents;
                unpaidCents += w.prizeCents;
            }
        } else {
            if (w.frozen) {
                frozenWinIds.push(w.winId);
                frozenCents += w.prizeCents;
                unpaidCents += w.prizeCents;
            } else {
                // check for forfeited wins
                const forfeitsAt = winTime + forfeitAfter;
                if (now < forfeitsAt) {
                    availableWinIds.push(w.winId);
                    availableCents += w.prizeCents;
                    unpaidCents += w.prizeCents;
                } else {
                    forfeitedWinIds.push(w.winId);
                    forfeitedCents += w.prizeCents;
                    unpaidCents += w.prizeCents;
                }
            }
        }
    });
    
    let payoutThreshold = config.payoutThresholdCents;
    const eligibleForPayout = availableCents >= payoutThreshold && !user?.gameBan;

    return {
        wins,
        availableWinIds,
        frozenWinIds,
        forfeitedWinIds,
        prizeTotalCents,
        winsThisWeek,
        weekTotalCents,
        unpaidCents,
        availableCents,
        paidCents,
        pendingCents,
        frozenCents,
        forfeitedCents,
        eligibleForPayout,
        hasPending,
        payoutThreshold
    }
}

export default getBalanceSummary;

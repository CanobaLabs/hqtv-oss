import { Request } from 'express';
import validator from 'validator';
import Audit from '../../common/database/adminModels/audit';
import { userDb } from '../../common/database/connections';
import Payout from '../../common/database/userModels/payout';
import Win from '../../common/database/userModels/win';
import HqError from '../../common/hqError';
import centsToDollars from '../../common/utils/centsToDollars';
import getBalanceSummary from '../utils/getBalanceSummary';
import { Op } from 'sequelize';
import redis from '../../common/redisClient';
import rKey from '../../common/redisKeys';

export async function getWin(winIdStr: string) {
	const win = await Win.findOne({ where: { winId: winIdStr } });
	return win;
}

export async function getPayout(payoutIdStr: string) {
	const payout = await Payout.findOne({ where: { id: payoutIdStr } });
	return payout;
}

export async function getHistoryOfPayout(payoutIdStr: string) {
	const audit = await Audit.findAll({
        where: { subTo: payoutIdStr, subToType: "payout" },
        order: [ ['date', 'DESC'] ]
    });
	return audit;
}

export async function getRecentWinsOfPlayer(userIdStr: string) {
    const wins = await Win.findAll({
        where: { userId: userIdStr },
        order: [ ['winDate', 'DESC'] ]
    });
    return wins;
}

export async function changeFreezeStatusOfWin(winIdStr: string, freeze: unknown, actioningEmployeeId: string) {
	if (!freeze || typeof freeze !== 'boolean') throw new HqError('Invalid body', 0, 400);
	
	// Get the win before updating to check if it exists and get its details
	const win = await Win.findOne({ where: { winId: winIdStr } });
	if (!win) {
		throw new HqError('Win not found', 0, 404);
	}
	
	// Check if the status is actually changing
	if (win.frozen === freeze) {
		return { success: true, message: `Win is already ${freeze ? 'frozen' : 'unfrozen'}` };
	}
	
	// Update the win and invalidate cache
	await Promise.all([
		Win.update({ frozen: freeze }, { where: { winId: winIdStr } }),
		Audit.create({
			to: winIdStr,
			toType: 'win',
			subTo: win.gameId.toString(),
			subToType: 'game',
			from: actioningEmployeeId,
			fromType: 'employee',
			action: 'edit_win_frozen',
			description: `${freeze ? 'Frozen' : 'Unfrozen'} win ${winIdStr} for game ${win.gameId} (${centsToDollars(win.prizeCents)}, ${win.prizePoints.toLocaleString('en-US')} points)`
		}),
		redis.del(rKey.apGameWins(win.gameId.toString()))
	]);
	
	return { success: true };
}

export async function massEditWinsForGame(gameIdStr: string, body: { frozen?: boolean }, actioningEmployeeId: string) {
	const gameId = parseInt(gameIdStr, 10);
	if (isNaN(gameId)) {
		throw new HqError('Invalid game ID', 0, 400);
	}
	
	// Validate that at least one field is provided
	if (body.frozen === undefined) {
		throw new HqError('At least one field must be provided (frozen)', 0, 400);
	}
	
	// Validate frozen is a boolean
	if (typeof body.frozen !== 'boolean') {
		throw new HqError('frozen must be a boolean', 0, 400);
	}
	
	// Find all wins for this game that will be affected
	const allWins = await Win.findAll({
		where: { gameId: gameId }
	});
	
	if (allWins.length === 0) {
		return { 
			success: true, 
			message: 'No wins found for this game',
			updatedCount: 0
		};
	}
	
	// Filter wins that will actually change
	const winsToUpdate = allWins.filter(win => win.frozen !== body.frozen);
	
	if (winsToUpdate.length === 0) {
		return {
			success: true,
			message: `All wins for this game are already ${body.frozen ? 'frozen' : 'unfrozen'}`,
			updatedCount: 0,
			totalWins: allWins.length
		};
	}
	
	// Calculate total prize amount for audit
	const totalPrizeCents = winsToUpdate.reduce((sum, win) => sum + win.prizeCents, 0);
	const totalPrizePoints = winsToUpdate.reduce((sum, win) => sum + win.prizePoints, 0);
	
	// Update all wins for this game and invalidate cache
	await Promise.all([
		Win.update(
			{ frozen: body.frozen },
			{ where: { gameId: gameId } }
		),
		Audit.create({
			to: gameIdStr,
			toType: 'game',
			from: actioningEmployeeId,
			fromType: 'employee',
			action: 'mass_edit_wins',
			description: `${body.frozen ? 'Frozen' : 'Unfrozen'} ${winsToUpdate.length} win(s) for game ${gameIdStr} (${centsToDollars(totalPrizeCents)} total, ${totalPrizePoints.toLocaleString('en-US')} points)`
		}),
		redis.del(rKey.apGameWins(gameIdStr))
	]);
	
	return {
		success: true,
		updatedCount: winsToUpdate.length,
		totalWins: allWins.length,
		totalPrizeCents,
		totalPrizePoints,
		frozen: body.frozen
	};
}

export async function updatePaidStatusOfPayout(payoutIdStr: string, requestingEmployeeId: string, paid: unknown) {
	const payout = await Payout.findOne({ where: { payoutId: payoutIdStr } });
    if (!payout) {
        throw new HqError('Payout not found.', 101, 404);
    }
	if (typeof paid !== 'boolean') throw new HqError('Invalid body', 0, 400);
    await Payout.update({ paid: +paid, modified: new Date().toISOString() }, { where: { payoutId: payoutIdStr } });
    await Audit.create({
        to: payout.userId.toString(),
        toType: 'account',
        subTo: payout.payoutId.toString(),
        subToType: 'payout',
        from: requestingEmployeeId,
        fromType: 'employee',
        action: 'set_payout',
        description: paid ? 'Paid ' + centsToDollars(payout.amountCents) : 'Reversed payment of ' + centsToDollars(payout.amountCents),
    });
    return { success: true };
}

export async function getAllRecentWins() {
	const wins = await Win.findAll({
        order: [ ['winDate', 'DESC'] ]
    });
	return wins;
}

export async function getAllRecentPayouts() {
	const payouts = await Payout.findAll({
        order: [ ['created', 'DESC'] ]
	});
	return payouts;
}

export async function createPayout(userId: number, payoutType: unknown, inputEmail: unknown, headers: Request['headers'] = {}) {
	const isDonation = payoutType === 'charity';
	const payout = await userDb.transaction(async transaction => {
		const balanceSumm = await getBalanceSummary(userId, transaction);
		if (!balanceSumm.eligibleForPayout) {
			throw new HqError('you do not have enough money to enable a payout', 422, 400);
		}
		
		const email = (inputEmail ?? '').toString().toLowerCase();
		if (!isDonation && !validator.isEmail(email)) {
			throw new HqError('bad email', 0, 400);
		}

		// ensure both succeed
		const payout = await Payout.create({
			userId: userId,
			amountCents: balanceSumm.availableCents,
			payoutEmail: isDonation ? 'GIVEBACK' : email,
			paid: isDonation,
			client: headers['x-hq-client'],
			ipAddress: headers['x-forwarded-for']
		}, { transaction });
		await Audit.create({
			to: userId.toString(),
			toType: 'account',
			subTo: payout.payoutId.toString(),
			subToType: 'payout',
			from: userId,
			fromType: 'account',
			action: 'create_payout',
			description: isDonation ? 'Donated ' + centsToDollars(balanceSumm.availableCents): 'Requested ' + centsToDollars(balanceSumm.availableCents),
		}); // add transaction support
		await Win.update(
			{ payoutId: payout.payoutId },
			{ where: { winId: { [Op.in]: balanceSumm.availableWinIds } }, transaction }
		);
		return payout;
	});

	return {
		data: {
			payoutId: payout.payoutId,
			userId: payout.userId,
			amount: centsToDollars(payout.amountCents),
			currency: 'USD',
			targetUserId: null,
			targetEmail: payout.payoutEmail,
			targetPhone: null,
			status: 2,
			created: payout.created,
			modified: payout.modified
		}
	}
}

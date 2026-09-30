import { Op } from 'sequelize';
import { all } from 'better-all';
import Broadcast from '../../common/database/eventModels/broadcast';
import Schedule from '../../common/database/eventModels/schedule';
import GamePlayed from '../../common/database/userModels/gamesPlayed';
import GiftDropClaim from '../../common/database/userModels/giftDropClaim';
import Win from '../../common/database/userModels/win';
import logger from '../../common/logger';
import redis from '../../common/redisClient';
import Currency from '../../common/types/currency';
import adjustItemBalance from '../../common/utils/adjustItemBalance';
import DiscordPrompt from '../wsTypes/DiscordPrompt';
import rGameKey from '../wsTypes/redisGameKeys';
import WinInfo from '../redisSchemas/winInfo';
import sendDiscordPrompter from '../helpers/sendDiscordPrompter';
import WsGameInfo from '../wsTypes/WsGameInfo';
import auditStreaks from '../websocketApi/auditStreaks';
import rKey from '../../common/redisKeys';
import CrossServer from '../helpers/CrossServer';
import { invalidateBroadcastCache } from '../../common/utils/gameDataCache';
import generateSchedule from '../../api/utils/generateSchedule';
import generateCalendar from '../../api/utils/generateCalendar';

async function masterEndGameHandler(gameInfo: WsGameInfo, broadcastId: number) {
    const showCard = await Schedule.findOne({ where: { gameId: gameInfo.gameId, rehearsal: gameInfo.rehearsal } });
    if (showCard) {
        // hide show card
        await Schedule.destroy({ where: { itemId: showCard.itemId }, limit: 1 });
        const nextShowCard = await Schedule.findOne({ where: { startTime: { [Op.gt]: showCard.startTime }, rehearsal: gameInfo.rehearsal } });
        if (nextShowCard?.autoVisible) {
            await Schedule.update(
                { visible: true },
                { where: { itemId: nextShowCard.itemId }, limit: 1 }
            );
        }
    }
    await Promise.all([
        generateSchedule('normal', true),
        generateSchedule('rehearsal', true),
        generateSchedule('all', true),
        generateCalendar()
    ]);

    await CrossServer.sendAllServers('broadcastEnded', broadcastId);
    
    sendDiscordPrompter([
        new DiscordPrompt(gameInfo, 'now', 'Broadcast ended').embed
    ]);
    
    await all({
        async redisUpdate() {
            return redis.multi()
                .hSet(rGameKey(broadcastId).gameInfo, 'ended', new Date().toISOString())
                .set(rGameKey(broadcastId).gameActiveFlag, 0)
                .exec();
        },
        async broadcastUpdate() {
            const result = await Broadcast.update({ ended: new Date() }, { where: { broadcastId: +broadcastId }, limit: 1 });
            invalidateBroadcastCache(broadcastId).catch(() => {});
            return result;
        }
    });

    await Promise.all([
        redis.del(rKey.apGameSchedule(gameInfo.gameId.toString())),
        redis.set(rKey.scheduleLastEdited, new Date().toISOString())
    ]);

    // group items by qty to bulk update DB
    async function bulkAwardItemsByQty(item: Currency, rKey: string, type: 'award' | 'deduct', reason: string) {
        const awardGroups: { [qty: string]: string[] } = {};
        const itemsUsed = await redis.hGetAll(rKey);
        Object.entries(itemsUsed).forEach(([plrId, qty]) =>
            (awardGroups[type === 'award' ? +qty : -(+qty)] ??= []).push(plrId)
        );
        await Promise.all(
            Object.entries(awardGroups).map(([qty, playerIds]) =>
                adjustItemBalance(playerIds.map(id => +id), { [item]: +qty }, { reason, broadcastId })
            )
        );
        logger.info(`awarded ${item} for ${reason}`);
    }
    
    if (gameInfo.forReal) {
        await Promise.all([
            bulkAwardItemsByQty('lives', rGameKey(broadcastId).livesUsed, 'deduct', 'live'),
            bulkAwardItemsByQty('erasers', rGameKey(broadcastId).erasersUsed, 'deduct', 'live'),
            bulkAwardItemsByQty('seasonXp', rGameKey(broadcastId).sessionPoints, 'award', 'live'),
            bulkAwardItemsByQty('seasonXp', rGameKey(broadcastId).pointsWonFromJackPot, 'award', 'prize'),
            bulkAwardItemsByQty('lives', rGameKey(broadcastId).superSpinLivesWon, 'award', 'spin')
        ]);
        await Promise.all([
            bulkAwardItemsByQty('coins', rGameKey(broadcastId).keepPlayingRewardCoins, 'award', 'kp'),
            bulkAwardItemsByQty('lives', rGameKey(broadcastId).keepPlayingRewardLives, 'award', 'kp'),
            bulkAwardItemsByQty('erasers', rGameKey(broadcastId).keepPlayingRewardErasers, 'award', 'kp'),
        ]);
        const usedSuperSpinPlrIds = await redis.sMembers(rGameKey(broadcastId).usedSuperSpin);
        await adjustItemBalance(usedSuperSpinPlrIds.map(id => +id), { superSpins: -1 }, { reason: 'used', broadcastId });

        // checkpoint
        const checkpointIds = await redis.zRange(rGameKey(broadcastId).allCheckpointIds, '-inf', '+inf', { BY: 'SCORE' });
        const allCheckpointPrizes = await Promise.all([
            Promise.all([redis.hGetAll(rGameKey(broadcastId).cashWonFromJackPot), redis.hGetAll(rGameKey(broadcastId).pointsWonFromJackPot)]), // jackpot prizes and points
            ...checkpointIds.map(id => Promise.all([ // checkpoint prizes and points
                redis.hGetAll(rGameKey(broadcastId).checkpoint(id).prizes),
                redis.hGetAll(rGameKey(broadcastId).checkpoint(id).points),
                id
            ]))
        ]);
        const flatCheckpointWinInfo: [number, number, number, string | undefined][] = allCheckpointPrizes.flatMap(([prizes, points, checkpointId]) => {
            const winInfo: [number, number, number, string | undefined][] = Object.entries(prizes).map(([userIdStr, prizeCentsStr]) => {
                return [+userIdStr, +prizeCentsStr, +(points?.[userIdStr] ?? 0), checkpointId];
            });
            return winInfo;
        });
        const checkpointWinRecords = flatCheckpointWinInfo.map(([userId, prizeCents, prizePoints, checkpointId]) => ({
            userId: userId,
            gameId: gameInfo.gameId,
            showType: gameInfo.showType,
            prizeCents: prizeCents,
            prizePoints: prizePoints,
            checkpointId: checkpointId
        }));
        if (checkpointWinRecords.length > 0) {
            await Promise.all([
                Win.bulkCreate(checkpointWinRecords),
                redis.multi()
                    .del('leaderboard:0')
                    .del('leaderboard:1')
                    .exec(),
                redis.del(rKey.apGameWins(gameInfo.gameId.toString()))
            ]);
        }
        logger.info('awarded wins');

        await (async () => {
            const scores: { [plrId: string]: number; } = {};
            const correctlyAnsweredMulti = redis.multi();
            for (let i = 1; i <= gameInfo.questionCount; i++) {
                correctlyAnsweredMulti.sMembers(rGameKey(broadcastId).question(i).correctPlayers);
            }
            const correctlyAnswered = await correctlyAnsweredMulti.exec() as string[][];
            correctlyAnswered.reverse().forEach((playerIds, i) => {
                // read backwards to find best score
                playerIds.forEach(plrId => {
                    if (scores[plrId] == null) {
                        scores[plrId] = gameInfo.questionCount - i;
                    }
                });
            });
            const joinedPlayers = await redis.sMembers(rGameKey(broadcastId).joinedPlayers);
            const joinTimes = await redis.hGetAll(rGameKey(broadcastId).joinTime);
            const clientHeaders = await redis.hGetAll(rGameKey(broadcastId).xHqClient);
            const gamePlayedRecords = joinedPlayers.map(plrId => ({
                gameId: gameInfo.gameId,
                broadcastId: broadcastId,
                userId: plrId,
                score: scores[plrId] ?? 0,
                joined: joinTimes[plrId] ? new Date(joinTimes[plrId]) : null,
                client: clientHeaders[plrId] ?? null
            }));
            await GamePlayed.bulkCreate(gamePlayedRecords);
        })();
        if (!gameInfo.rehearsal) {
            await auditStreaks(broadcastId);
        }

        const giftDropsDuringGame = await redis.sMembers(rGameKey(broadcastId).giftDropIds);
        
        // Process all gift drops in parallel
        await Promise.all(giftDropsDuringGame.map(async giftDropId => {
            const awards = await redis.hGetAll(rGameKey(broadcastId).giftDrop(+giftDropId));
            const awardGroups: { [itemType: string]: { [qty: string]: string[]; } } = {};
            Object.entries(awards).forEach(([plrId, awardStr]) => {
                // group awards by item type and quantity
                const [itemType, itemQty]: [string, number] = JSON.parse(awardStr);
                awardGroups[itemType] ??= {};
                (awardGroups[itemType][itemQty.toString()] ??= []).push(plrId);
            });
            
            // Process all award groups for this gift drop
            await Promise.all(Object.entries(awardGroups).map(async ([itemType, quantitiesAwarded]) => {
                function getDbItemName() {
                    switch (itemType) {
                        case 'extraLives': { return 'lives'; };
                        case 'coins': { return 'coins'; };
                        case 'erasers': { return 'erasers'; };
                        case 'superSpins': { return 'superSpins'; };
                        case 'seasonXp': { return 'seasonXp'; };
                    }
                }
                const dbItemName = getDbItemName();
                if (!dbItemName) return;

                // Process all quantities for this item type
                await Promise.all(Object.entries(quantitiesAwarded).map(async ([qty, playerIds]) => {
                    // award to acct
                    await adjustItemBalance(playerIds.map(id => +id), { [dbItemName]: +qty }, { reason: `giftDropId=${giftDropId}`, broadcastId });
                    await GiftDropClaim.bulkCreate(
                        playerIds.flatMap(plrId => ({
                            giftDropId,
                            userId: +plrId,
                            showId: +gameInfo.gameId,
                            itemType: itemType,
                            itemQuantity: +qty
                        }))
                    );
                }));
            }));
        }));
    }
}

export default masterEndGameHandler;

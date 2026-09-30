import HqError from '../../common/hqError';
import logger from '../../common/logger';
import redis from '../../common/redisClient';
import WsGameInfo from '../wsTypes/WsGameInfo';
import rGameKey from '../wsTypes/redisGameKeys';
import checkpointMethods from '../helpers/CheckpointMethods';
import ms from 'ms';
import sendDiscordPrompter from '../helpers/sendDiscordPrompter';
import DiscordPrompt from '../wsTypes/DiscordPrompt';
import masterCheckpointSummaryHandler from './masterCheckpointSummary';
import CrossServer from '../helpers/CrossServer';
import sendProducerCheckpointStatus from '../helpers/sendProducerCheckpointStatus';
import sendProducerCheckpoint from '../helpers/sendProducerCheckpoint';

async function masterCheckpointHandler(gameInfo: WsGameInfo, broadcastId: number, force: string = "false") {
    const { questionNumber } = gameInfo;
    const nextCheckpoint = (await checkpointMethods(broadcastId).getIds()).next[0];
    const checkpointInfo = nextCheckpoint && (await checkpointMethods(broadcastId).getCheckpointInfo(nextCheckpoint.value)).currentCheckpoint!;
    const eligiblePlayersCount = await redis.sCard(rGameKey(broadcastId).inTheGame);
    if ((!nextCheckpoint || nextCheckpoint.score != questionNumber) && force != "true") {
        throw new HqError('A checkpoint does not belong to this question', 0, 400);
    }
    if (eligiblePlayersCount == 0) {
        throw new HqError('There are no players in', 0, 400);
    }
    const shouldSplitPrize = checkpointInfo.splitPrize ? JSON.parse(checkpointInfo.splitPrize) : false;
    const offerCents = shouldSplitPrize && checkpointInfo.prizeTotalCents !== undefined ? 
        +checkpointInfo.prizeTotalCents / eligiblePlayersCount : 
        (checkpointInfo.prizeTotalCents !== undefined ? +checkpointInfo.prizeTotalCents : 0);
    const shouldSplitPoints = checkpointInfo.splitPoints ? JSON.parse(checkpointInfo.splitPoints) : false;
    const offerPoints = shouldSplitPoints && checkpointInfo.prizeTotalPoints !== undefined ?
        Math.round(+checkpointInfo.prizeTotalPoints / eligiblePlayersCount) : 
        (checkpointInfo.prizeTotalPoints !== undefined ? +checkpointInfo.prizeTotalPoints : 0);
    await redis.multi()
        .set(rGameKey(broadcastId).currentCheckpointId, nextCheckpoint.value)    
        .zRem(rGameKey(broadcastId).nextCheckpointIds, nextCheckpoint.value)
        .hSet(rGameKey(broadcastId).checkpoint(nextCheckpoint.value).cp, {
            offerStarted: Date.now(),
            prizeOfferCents: offerCents,
            prizeOfferPoints: offerPoints,
            eligiblePlayersCount: eligiblePlayersCount
        })
        .exec();
    await CrossServer.sendAllServers('checkpoint', broadcastId);
    sendProducerCheckpointStatus(broadcastId, nextCheckpoint.value).catch(err => logger.error('Failed to send producer checkpoint status', err));
    sendProducerCheckpoint(broadcastId, nextCheckpoint.value).catch(err => logger.error('Failed to send producer checkpoint', err));
    // Commented out for trivia games (except game start/end)
    // sendDiscordPrompter([
    //     new DiscordPrompt(gameInfo, 'now').checkpointOffer(checkpointInfo.checkpointId)
    // ]);

    // auto results
    setTimeout(() => {
        masterCheckpointSummaryHandler(gameInfo).catch((err) => {
            logger.error({ err, broadcastId: gameInfo.broadcastId, gameId: gameInfo.gameId }, 'Error in masterCheckpointSummaryHandler');
        });
    }, ms('15 seconds'));
}

export default masterCheckpointHandler;

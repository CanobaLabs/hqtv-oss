import redis from '../../common/redisClient';
import checkpointMethods from './CheckpointMethods';
import rGameKey from '../wsTypes/redisGameKeys';
import CrossServer from './CrossServer';
import getCheckpointStatus from './getCheckpointStatus';

async function sendProducerCheckpoint(broadcastId: number, checkpointId: string) {
    const status = await getCheckpointStatus(broadcastId, checkpointId);
    if (status === 'notStarted') {
        return;
    }

    const { currentCheckpoint } = await checkpointMethods(broadcastId).getCheckpointInfo(checkpointId);
    if (!currentCheckpoint) {
        return;
    }

    const eligiblePlayersCount = currentCheckpoint.eligiblePlayersCount ? +currentCheckpoint.eligiblePlayersCount : await redis.sCard(rGameKey(broadcastId).inTheGame);

    const checkpointMessage = {
        type: 'producerCheckpoint',
        checkpointId: checkpointId,
        prizeOfferCents: currentCheckpoint.prizeOfferCents ? +currentCheckpoint.prizeOfferCents : 0,
        prizeOfferPoints: currentCheckpoint.prizeOfferPoints ? +currentCheckpoint.prizeOfferPoints : 0,
        eligiblePlayersCount: eligiblePlayersCount
    };

    await CrossServer.sendAllServers('producerMessage', broadcastId, { message: checkpointMessage });
}

export default sendProducerCheckpoint;


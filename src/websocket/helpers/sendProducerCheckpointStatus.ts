import CrossServer from './CrossServer';
import logger from '../../common/logger';
import getCheckpointStatus from './getCheckpointStatus';

async function sendProducerCheckpointStatus(broadcastId: number, checkpointId: string) {
    try {
        const status = await getCheckpointStatus(broadcastId, checkpointId);
        
        const statusMessage = {
            type: 'checkpointStatus',
            checkpointId: checkpointId,
            status: status
        };
        await CrossServer.sendAllServers('producerMessage', broadcastId, { message: statusMessage });
    } catch (err) {
        logger.error('Failed to send producer checkpoint status', { err, broadcastId, checkpointId });
    }
}

export default sendProducerCheckpointStatus;


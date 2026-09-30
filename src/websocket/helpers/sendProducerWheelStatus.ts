import getWheelStatus from './getWheelStatus';
import CrossServer from './CrossServer';
import logger from '../../common/logger';

async function sendProducerWheelStatus(broadcastId: number) {
    try {
        const status = await getWheelStatus(broadcastId);
        
        const statusMessage = {
            type: 'wheelStatus',
            status: status
        };
        await CrossServer.sendAllServers('producerMessage', broadcastId, { message: statusMessage });
    } catch (err) {
        logger.error('Failed to send producer wheel status', { err, broadcastId });
    }
}

export default sendProducerWheelStatus;


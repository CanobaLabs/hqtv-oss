import getWinnersStatus from './getWinnersStatus';
import CrossServer from './CrossServer';
import logger from '../../common/logger';

async function sendProducerWinnersStatus(broadcastId: number) {
    try {
        const status = await getWinnersStatus(broadcastId);
        
        const statusMessage = {
            type: 'winnersStatus',
            status: status
        };
        await CrossServer.sendAllServers('producerMessage', broadcastId, { message: statusMessage });
    } catch (err) {
        logger.error('Failed to send producer winners status', { err, broadcastId });
    }
}

export default sendProducerWinnersStatus;


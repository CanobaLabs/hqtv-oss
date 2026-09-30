import CrossServer from './CrossServer';
import logger from '../../common/logger';
import WinInfo from '../redisSchemas/winInfo';

async function sendProducerWinners(broadcastId: number, winners: WinInfo[]) {
    try {
        const message = {
            type: 'winners',
            winners: winners
        };

        await CrossServer.sendAllServers('producerMessage', broadcastId, { message });
    } catch (err) {
        logger.error('Failed to send producer winners', { err, broadcastId });
    }
}

export default sendProducerWinners;


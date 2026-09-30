import constructProducerPlayerList from '../constructors/constructProducerPlayerList';
import CrossServer from './CrossServer';

async function sendProducerPlayerList(broadcastId: number) {
    const playerList = await constructProducerPlayerList(broadcastId);
    await CrossServer.sendAllServers('producerMessage', broadcastId, { message: playerList });
}

export default sendProducerPlayerList;

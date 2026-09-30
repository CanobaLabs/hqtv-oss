import { wsServers } from '../wsServers';

async function subProducerMessageHandler(broadcastId: number, metadata: { message: Record<string, unknown> }) {
    const wss = wsServers[broadcastId]?.wss;
    if (wss && metadata.message) {
        wss.sendProducers(metadata.message);
    }
}

export { subProducerMessageHandler };

import { wsServers } from '../wsServers';

interface SubCustomArgs {
    payload: Record<string, unknown>;
}

async function subCustomHandler(broadcastId: number, e: SubCustomArgs) {
    wsServers[broadcastId]?.wss.forEachClient(client => {
        client.sendGameClient(e.payload);
    });
}

export { SubCustomArgs, subCustomHandler };

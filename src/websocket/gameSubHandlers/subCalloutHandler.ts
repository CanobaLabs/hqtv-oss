import { wsServers } from '../wsServers';

interface SubCalloutArgs {
	payload: Record<string, unknown>;
}

async function subCalloutHandler(broadcastId: number, e: SubCalloutArgs) {
	wsServers[broadcastId]?.wss.sendAll(e.payload);
}

export { SubCalloutArgs, subCalloutHandler };

import constructBroadcastEnded from '../constructors/constructBroadcastEnded';
import { wsServers } from '../wsServers';

async function subBroadcastEndedHandler(broadcastId: number) {
    const wssInfo = wsServers[broadcastId];
    if (wssInfo) {
        wssInfo.active = false; // stop new joins
        wssInfo.stopServices(); // stop viewer updating, etc.
        wssInfo.wss.forEachClient(c => { // disconnect players
            c.sendGameClient(constructBroadcastEnded());
            c.close(1000);
        });
    }
}

export { subBroadcastEndedHandler };

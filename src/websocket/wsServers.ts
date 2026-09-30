import ms from 'ms';
import constructBroadcastStats from './constructors/constructBroadcastStats';
import disconnectIdleClients from './helpers/disconnectIdleClients';
import relayChatToDiscord from './helpers/relayChatToDiscord';
import updateBroadcastStats from './helpers/updateBroadcastStats';
import HqWebSocket from './wsTypes/HqWebSocket';
import HqWebSocketServer from './wsTypes/HqWebSocketServer';
import CrossServer from './helpers/CrossServer';
import getGeneralConfig from '../api/utils/getGeneralConfig';

const wsServers: {
    [broadcastId: number]: { wss: HqWebSocketServer; active: boolean; stopServices: () => void; } | null;
} = {};

async function createWsServer(broadcastId: number) {
    const wss = new HqWebSocketServer({ noServer: true, WebSocket: HqWebSocket });
    wss.broadcastId = broadcastId;
    
    const config = await getGeneralConfig();
    
    const services = [
        setInterval(async () => {
            await updateBroadcastStats(broadcastId);
            wss.sendAll(await constructBroadcastStats(broadcastId));
        }, ms(`${config.wsStatsUpdateIntervalSec} seconds`)),
        setInterval(() => {
            disconnectIdleClients(broadcastId)
        }, ms(`${config.wsIdleDisconnectIntervalSec} seconds`)),
        setInterval(() => {
            relayChatToDiscord(broadcastId)
        }, ms(`${config.wsChatRelayIntervalSec} seconds`))
    ]

    const wssInfo = { wss: wss, active: true, stopServices: () => services.forEach(s => clearInterval(s)) };
    wsServers[broadcastId] = wssInfo;
    CrossServer.connectListener(broadcastId) // cross-server support - not vital
    return wssInfo;
}

export { createWsServer, wsServers };


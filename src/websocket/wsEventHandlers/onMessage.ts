import HqError from '../../common/hqError';
import HqWebSocket from '../wsTypes/HqWebSocket';
import { PlayerEventName, playerEventHandlers } from '../wsTypes/playerEvents';

async function onMessage(ws: HqWebSocket, data: string, currentGameType: string) {
    let message;
    try {
        message = JSON.parse(data);
    } catch {
        ws.sendJson(new HqError('bad json payload from client', 400));
        return ws.close(1000);
    }
    
    if (ws.subscribed || message.type === 'subscribe') {
        // must be subscribed to interact
        // this is so that kicked people are blocked
        const eventName = message.type as PlayerEventName;
        const eventInfo = playerEventHandlers[eventName];
        if (eventInfo) {
            const [handler, eventGameTypes] = eventInfo;
            if (eventGameTypes?.includes(currentGameType)) {
                handler(ws, message);
            }
        }
    }
}

export default onMessage;

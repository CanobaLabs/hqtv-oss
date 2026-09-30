import { v4 as uuidv4 } from 'uuid';
import { WebSocket } from 'ws';

class HqWebSocket extends WebSocket {
    userId = 0;
    playerId = '0';
    broadcastId = 0;
    player = { playerId: this.playerId, broadcastId: this.broadcastId };
    producer: { discordId: string; } | null = null;
    sessionUuid = uuidv4();
    subscribed = false;
    isAlive = true;
    hasNewConnection = false;
    chatVisible = true;
    chatCooldownExpiry = 0;
    messageCount = 0;
    xHqClient: string | undefined;
    public sendJson(data: unknown) {
        // wrapper prepares data for sending
        this.send(JSON.stringify(data));
    };
    async sendGameClient(payload: Record<string, unknown>, ts?: Date) {
        // add metadata
        this.sendJson({
            type: payload.type,
            ts: ts ?? new Date(),
            ...payload,
            sent: new Date(),
            c: ++this.messageCount
        });
    };
}

export default HqWebSocket;

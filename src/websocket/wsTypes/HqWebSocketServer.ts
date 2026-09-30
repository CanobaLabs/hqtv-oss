import { WebSocketServer } from 'ws';
import logger from '../../common/logger';
import HqWebSocket from './HqWebSocket';

class HqWebSocketServer extends WebSocketServer<typeof HqWebSocket> {
    broadcastId = 0;

    async forEachClient(cb: (client: HqWebSocket) => unknown) {
        this.clients.forEach(client => {
            Promise.resolve(cb(client)).catch(err => logger.error(err));
        });
    }
    
    async sendAll(cb: Record<string, unknown> | ((client: HqWebSocket) => Record<string, any> | Promise<Record<string, any>>)) {
        const ts = new Date();
        this.clients.forEach(client => {
            if (typeof cb === 'function') {
                // personalise
                Promise.resolve(cb(client))
                    .then(payload => {
                        client.sendGameClient(payload, ts);
                    })
                    .catch(err => logger.error(err));
            } else {
                // send directly
                client.sendGameClient(cb, ts);
            }
        });
    };

    async sendProducers(cb: Record<string, unknown>) {
        const ts = new Date();
        this.clients.forEach(client => {
            if (client.producer) {
                client.sendGameClient(cb, ts);
            }
        });
    };

    async bulkSend(cb: Record<string, unknown> | ((broadcastId: number, playerIds: string[]) => Promise<Record<string, unknown>[]>)) {
        const ts = new Date();
        const clients = [...this.clients];
        if (clients.length == 0) {
            return;
        }
        if (typeof cb == 'function') {
            // personalise
            const playerIds = clients.map(c => c.playerId);
            const payloads = await cb(this.broadcastId, playerIds);
            clients.forEach((c, i) => {
                const pl = payloads[i];
                c.sendGameClient(pl, ts);
            });
        } else {
            // same message for everyone
            clients.forEach(c => {
                c.sendGameClient(cb, ts);
            });
        }
    }
}

export default HqWebSocketServer;

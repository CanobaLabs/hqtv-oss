// isolated websocket server
import { WebSocketServer } from 'ws';
import HqWebSocket from './wsTypes/HqWebSocket';

const errorWss = new WebSocketServer({ noServer: true, WebSocket: HqWebSocket });

export default errorWss;

import HqWebSocket from '../wsTypes/HqWebSocket';

function handleChatVisibilityToggled(ws: HqWebSocket, payload: { chatVisible: boolean }) {
    ws.chatVisible = payload.chatVisible;
}

export default handleChatVisibilityToggled;

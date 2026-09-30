import HqWebSocket from '../wsTypes/HqWebSocket';
import WsQuestion from '../wsTypes/WsQuestion';
import { getErase1sRemaining } from '../helpers/playerMethods';
import HqErase1Answer from '../wsMessageTypes/HqErase1Answer';
import WsGameInfo from '../wsTypes/WsGameInfo';

async function constructErase1Answer(ws: HqWebSocket, question: WsQuestion, gameInfo: WsGameInfo) {
    return {
        type: 'erase1Answer',
        questionId: +question.id,
        answerId: +question.eraserAnswerId!,
        erase1sRemaining: await getErase1sRemaining(ws.player, gameInfo)
    } as HqErase1Answer;
}

export default constructErase1Answer;

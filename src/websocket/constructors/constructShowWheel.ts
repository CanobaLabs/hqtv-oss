import SuperWheelItem from '../../common/database/featureModels/superWheelItem';
import { getUser } from '../../common/utils/userGetters';
import HqWebSocket from '../wsTypes/HqWebSocket';
import HqShowWheel from '../wsMessageTypes/HqShowWheel';
import WsGameInfo from '../wsTypes/WsGameInfo';

function constructShowWheel(gameInfo: WsGameInfo) {
    return async function(ws: HqWebSocket) {
        const user = await getUser(ws.userId);
        return {
            type: 'showWheel',
            showId: +gameInfo.gameId,
            roundId: 0,
            letters: gameInfo.wheelLetters,
            superWheel: gameInfo.superWheelItems.map(itm => ({ name: itm.name, letters: itm.letters, extraLives: itm.lives })),
            superSpins: user.superSpins
        } as HqShowWheel;
    }
}

export default constructShowWheel;

import CrossServer from '../helpers/CrossServer';
import getGameInfo from '../helpers/getGameInfo';

async function masterDynamicPotAnimationHandler(_: unknown, broadcastId: number) {
    const { prizeCents, prizePoints } = await getGameInfo(broadcastId);
    await CrossServer.sendAllServers('dynamicPotAnimation', broadcastId, { prizeCents: +prizeCents, prizePoints: +prizePoints });
}

export default masterDynamicPotAnimationHandler;

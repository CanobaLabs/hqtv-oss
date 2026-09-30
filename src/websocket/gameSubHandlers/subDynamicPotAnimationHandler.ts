import constructDynamicPotAnimation from '../constructors/constructDynamicPotAnimation';
import { wsServers } from '../wsServers';

type SubDynamicPotAnimationArgs = {
    prizeCents: number;
    prizePoints: number;
}

async function subDynamicPotAnimationHandler(broadcastId: number, e: SubDynamicPotAnimationArgs) {
    wsServers[broadcastId]?.wss.sendAll(constructDynamicPotAnimation(e.prizeCents, e.prizePoints));
}

export { subDynamicPotAnimationHandler };

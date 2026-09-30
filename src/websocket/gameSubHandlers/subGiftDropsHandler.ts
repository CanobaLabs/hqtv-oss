import constructGiftDrop from '../constructors/constructGiftDrop';
import { wsServers } from '../wsServers';

interface SubGiftDropArgs {
    giftDropId: number;
}

async function subGiftDropHandler(broadcastId: number, e: SubGiftDropArgs) {
    wsServers[broadcastId]?.wss.forEachClient(async client => {
        const message = await constructGiftDrop(e.giftDropId, client.player);
        if (message) {
            // if undefined then there is no gift for the player (joined between gifting and sending)
            client.sendGameClient(message);
        }
    });
}

export { SubGiftDropArgs, subGiftDropHandler };

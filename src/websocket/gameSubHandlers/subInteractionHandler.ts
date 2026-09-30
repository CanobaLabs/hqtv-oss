import User from '../../common/types/user';
import { getUser } from '../../common/utils/userGetters';
import HqWebSocket from '../wsTypes/HqWebSocket';
import constructInteraction from '../constructors/constructInteraction';
import generateBasicUser from '../helpers/generateBasicUser';
import { wsServers } from '../wsServers';
import getFriendIds from '../../common/utils/getFriendIds';

interface SubInteractionArgs {
    senderUuid: string;
    user: ReturnType<typeof generateBasicUser>;
    metadata: Record<string, unknown>;
    deviceEmoji: string;
}

async function subInteractionHandler(broadcastId: number, e: SubInteractionArgs) {
    if (!wsServers[broadcastId]) return;
    const clientUsers: [HqWebSocket, User][] = await Promise.all(
        [...wsServers[broadcastId]!.wss.clients].map(async c => [c, await getUser(c.userId)])
    );
    await Promise.all(clientUsers.map(async ([client, user]) => {
        if (client.sessionUuid !== e.senderUuid) {
            // don't echo to sender
            if (client.chatVisible) {
                const receiverFriendIds = await getFriendIds(user.id);
                const receiverIsFriend = receiverFriendIds.includes(e.user.id);
                client.sendGameClient(constructInteraction(e.user, e.metadata, e.deviceEmoji)(user.admin, receiverIsFriend));
            }
        }
    }));
}

export { SubInteractionArgs, subInteractionHandler };

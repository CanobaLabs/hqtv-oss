import generateBasicUser from '../helpers/generateBasicUser';
import HqInteraction from '../wsMessageTypes/HqInteraction';

function constructInteraction(senderUser: ReturnType<typeof generateBasicUser>, metadataFromClient: Record<string, unknown>, deviceEmoji: string) {
    return function(receiverIsAdmin: boolean, receiverIsFriend?: boolean, feedback?: 'rateLimited') {
        let displayName = senderUser.name;
        if (receiverIsFriend) {
            displayName = '👋 ' + displayName;
        }
        if (receiverIsAdmin) {
            displayName = deviceEmoji + displayName;
        }

        let cooldownMetadata = {};
        if (feedback === 'rateLimited') {
            cooldownMetadata = {
                originalMessage: metadataFromClient.message,
                message: 'Too many messages! Wait a few seconds...',
                feedback: 'feedback'
            }
        }

        return {
            type: 'interaction',
            itemId: 'chat',
            userId: senderUser.id,
            metadata: {
                ...metadataFromClient,
                ...cooldownMetadata,
                userId: senderUser.id,
                username: displayName
            }
        } as HqInteraction;
    }
}

export default constructInteraction;

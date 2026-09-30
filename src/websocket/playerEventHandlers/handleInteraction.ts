import ms from 'ms';
import HqError from '../../common/hqError';
import logger from '../../common/logger';
import HqWebSocket from '../wsTypes/HqWebSocket';
import constructInteraction from '../constructors/constructInteraction';
import constructViewerEvent from '../constructors/constructViewerEvent';
import runGameCommand from '../gameMasterHandlers/runGameCommand';
import redis from '../../common/redisClient';
import rGameKey from '../wsTypes/redisGameKeys';
import { getUser } from '../../common/utils/userGetters';
import { ChatBanLevel } from '../../common/enums';
import generateBasicUser from '../helpers/generateBasicUser';
import CrossServer from '../helpers/CrossServer';
import getGeneralConfig from '../../api/utils/getGeneralConfig';

async function handleInteraction(ws: HqWebSocket, payload: { metadata: { message: string } }) {
    const user = await getUser(ws.userId);
    const deviceEmoji = ws.xHqClient?.startsWith('iOS') ? '🍎' : '🤖';
    
    const message = payload.metadata?.message;
    if (!message) {
        return;
    }

    if (user.chatBan > ChatBanLevel.NotBanned) {
        if (user.chatBan === ChatBanLevel.BannedNotify) {
            ws.sendGameClient(constructViewerEvent('You are banned from chatting.'));
        }
        return; // if they are shadow banned, their message won't be sent and they won't know
    }
    
    if (user.admin) {
        // game controls
        const chatCommands: { [cmdName: string]: string } = {
            ['/e']: 'question',
            ['/r']: 'questionResults',
            ['/c']: 'close',
            ['/cp']: 'checkpoint',
            ['/w']: 'winners',
            ['/sw']: 'wheel',
            ['/l']: 'revealLetter',
            ['/dp']: 'dynamicPotAnimation',
            ['/ve']: 'chatAnnounce',
            ['/end']: 'endGame'
        }
        const [gameCmdIn, ...args] = message.split(' ');
        const arg = args.join(' ');
        const gameCmd = chatCommands[gameCmdIn];
        if (gameCmd) {
            try {
                await runGameCommand(gameCmd as any, ws.broadcastId, arg);
            } catch (err) {
                if (err instanceof HqError) {
                    ws.sendGameClient(constructViewerEvent(err.error));
                } else {
                    logger.error(err);
                }
            }
            return; // don't broadcast commands
        }
    }

    const timeNow = Date.now();
    if (user.admin || timeNow > ws.chatCooldownExpiry) {
        // no cooldown for admins
        const config = await getGeneralConfig();
        ws.chatCooldownExpiry = timeNow + ms(`${config.chatCooldownSec} seconds`);
        
        redis.multi()
            .xAdd(rGameKey(ws.broadcastId).chatMessages, '*', { user: JSON.stringify({ ...user, deviceEmoji }), message })
            .xAdd(rGameKey(ws.broadcastId).unrelayedChat, '*', { user: JSON.stringify(user), message })
            .exec();
        // broadcast message
        await CrossServer.sendAllServers('interaction', ws.broadcastId, {
            user: generateBasicUser(user),
            metadata: payload.metadata,
            senderUuid: ws.sessionUuid,
            deviceEmoji: deviceEmoji
        });
    } else {
        // rate limited
        ws.sendGameClient(constructInteraction(generateBasicUser(user), payload.metadata, deviceEmoji)(false, false, 'rateLimited'));
    }
}

export default handleInteraction;

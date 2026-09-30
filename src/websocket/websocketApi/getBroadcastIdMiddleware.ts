import { NextFunction, Request, Response } from 'express';
import Broadcast from '../../common/database/eventModels/broadcast';
import HqError from '../../common/hqError';
import redis from '../../common/redisClient';
import rGameKey from '../wsTypes/redisGameKeys';
import catchErrors from '../../api/middleware/catchErrors';
import getGeneralConfig from '../../api/utils/getGeneralConfig';

const getBroadcastId = catchErrors(async (req: Request, res: Response, next: NextFunction) => {
    const gameId = +req.params.gameId;
    let broadcast: Broadcast | null;
    if (gameId == 0) {
        // assume current broadcast id
        broadcast = await Broadcast.findOne({ where: { ended: null }, order: [['started', 'DESC']] });
    } else {
        // find broadcast id from game id
        broadcast = await Broadcast.findOne({ where: { gameId, ended: null }, order: [['started', 'DESC']] });
    }
    if (broadcast) {
        req.broadcastId = broadcast.broadcastId;
    } else {
        throw new HqError(`Game not live. gameId=${gameId}`, 0, 400);
    }
    
    const config = await getGeneralConfig();
    const lockAcquired = await redis.set(rGameKey(req.broadcastId).runCommandLock, 1, { NX: true, EX: config.runCommandLockExpirySec });
    if (!lockAcquired) {
        throw new HqError('Rate limited', 0, 400);
    }
    next();
});

export default getBroadcastId;

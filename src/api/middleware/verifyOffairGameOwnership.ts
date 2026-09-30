import { NextFunction, Request, Response } from 'express';
import redis from '../../common/redisClient';
import HqError from '../../common/hqError';
import catchErrors from './catchErrors';
import rKey from '../../common/redisKeys';

const verifyOffairGameOwnership = catchErrors(async (req: Request, res: Response, next: NextFunction) => {
    const { gameUuid } = req.params;
    const [gameExists, gameOwnerIdStr] = await Promise.all([
        redis.exists(rKey.offairTriviaGameStatus(gameUuid)),
        redis.hGet(rKey.offairTriviaGameStatus(gameUuid), 'userId')
    ]);
    if (!gameExists) {
        throw new HqError('game not found', 0, 400);
    }
    const gameOwnerId = +(gameOwnerIdStr ?? '-1');
    if (gameOwnerId !== req.authUser.id) {
        throw new HqError('not your game', 0, 400);
    }
    return next();
});

export default verifyOffairGameOwnership;

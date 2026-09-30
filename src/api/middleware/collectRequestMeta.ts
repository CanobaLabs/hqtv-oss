import { NextFunction, Request, Response } from 'express';
import redis from '../../common/redisClient';
import rKey from '../../common/redisKeys';
import { getClientIp } from '../utils/getClientIp';

const collectRequestMeta = async (req: Request, res: Response, next: NextFunction) => {
    const multi = redis.multi();
    multi.set(rKey.userLastOnline(req.authUser.id), new Date().toISOString());
    multi.set(rKey.userRawHeaders(req.authUser.id), JSON.stringify(req.rawHeaders));
    const country = req.get('x-hq-country');
    if (country && country != '--') { multi.set(rKey.userCountry(req.authUser.id), country); } else {
        multi.set(rKey.userCountry(req.authUser.id), req.get('cf-ipcountry') ?? 'un');
    }
    
    // Track IP address for forensics (only on config endpoint to save bandwidth)
    const ipAddress = getClientIp(req);
    if (ipAddress) {
        multi.sAdd(rKey.userTrackedIps(req.authUser.id), ipAddress);
        // Maintain reverse index for efficient forensics lookups
        multi.sAdd(rKey.ipToUsers(ipAddress), String(req.authUser.id));
    }
    
    await multi.exec();
    return next();
};

export default collectRequestMeta;

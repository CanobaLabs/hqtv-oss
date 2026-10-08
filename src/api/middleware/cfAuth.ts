import redis from "../../common/redisClient";
import catchErrors from './catchErrors';
import getDiscordUser from "../utils/getDiscordUser";
import axios from 'axios';
import HqError from "../../common/hqError";
import logger from "../../common/logger";
import ms from 'ms';
import rKey from "../../common/redisKeys";
import getGeneralConfig from '../utils/getGeneralConfig';
import verifyCfAccessToken from '../utils/verifyCfAccessToken';

const SERVER_ID = '972240026425516052';

type CfAccessJwtPayload = {
    sub?: string;
    id?: string;
    email?: string;
    identity?: {
        id?: string;
    };
    custom?: {
        id?: string;
        name?: string;
        avatar?: string | null;
        verified?: boolean;
        mfa_enabled?: boolean;
    };
};

function toStringRecord(entries: Record<string, unknown>): [string, string][] {
    return Object.entries(entries).reduce<[string, string][]>((acc, [key, value]) => {
        if (value === undefined || value === null || value === '') {
            return acc;
        }
        if (typeof value === 'boolean') {
            acc.push([key, value ? 'true' : 'false']);
            return acc;
        }
        acc.push([key, String(value)]);
        return acc;
    }, []);
}

function buildRedisUserFromPayload(payload: CfAccessJwtPayload, includeName: boolean, fields?: Array<'email' | 'avatarId' | 'verified' | 'mfa_enabled'>): [string, string][] {
    const custom = payload.custom ?? {};
    const base: Record<string, unknown> = {
        userId: custom.id ?? payload.id ?? payload.sub ?? payload.identity?.id
    };

    const includeAll = !fields || fields.length === 0;

    if ((includeAll || fields.includes('verified')) && custom.verified !== undefined) {
        base.verified = custom.verified;
    }
    if ((includeAll || fields.includes('mfa_enabled')) && custom.mfa_enabled !== undefined) {
        base.mfa_enabled = custom.mfa_enabled;
    }
    if (includeName && custom.name) {
        base.name = custom.name;
    }
    if ((includeAll || fields.includes('email')) && payload.email) {
        base.email = payload.email;
    }
    if ((includeAll || fields.includes('avatarId')) && custom.avatar) {
        base.avatarId = custom.avatar;
    }

    return toStringRecord(base);
}

function cfAuth() {
    return catchErrors(async (req, res, next) => {
        const rawHeader = req.headers['authorization'];
        if (typeof rawHeader !== 'string' || !rawHeader.trim()) {
            throw new HqError('Auth not valid.', 105, 401);
        }

        const cfAuthHeader = rawHeader.trim();
        if (cfAuthHeader.startsWith("Bearer ")) return next(); // HQTV User Auth

        let tokenPayload: CfAccessJwtPayload | null = null;
        if (cfAuthHeader.split('.').length === 3) {
            // JWT: must carry a valid signature, expiry, issuer and audience. Never fall through to the unverified paths.
            try {
                tokenPayload = await verifyCfAccessToken(cfAuthHeader) as CfAccessJwtPayload;
            } catch (e) {
                logger.warn(`cfAuth token rejected: ${e instanceof Error ? e.message : e}`);
                throw new HqError('Auth not valid.', 105, 401);
            }
        }
        const userIdFromToken = tokenPayload?.custom?.id ?? tokenPayload?.id ?? tokenPayload?.identity?.id ?? tokenPayload?.sub;
        const nowIso = new Date().toISOString();

        if (userIdFromToken) {
            const cachedUser = await getDiscordUser(userIdFromToken);

            if (!cachedUser) {
                throw new HqError('Employee not found', 0, 404);
            }

            req.cfAuth = cachedUser;
            await redis.set(rKey.employeeLastOnline(cachedUser?.userId ?? ''), nowIso);

            if (tokenPayload) {
                const updateEntries = buildRedisUserFromPayload(tokenPayload, false, ['email', 'mfa_enabled']);
                if (updateEntries.length) {
                    const config = await getGeneralConfig();
                    const multi = redis.multi();
                    multi.hSet(rKey.employee(userIdFromToken), updateEntries);
                    multi.hSet(rKey.employee(cfAuthHeader), updateEntries);
                    multi.pExpire(rKey.employee(cfAuthHeader), ms(`${config.employeeCacheExpiryHours} hours`));
                    await multi.exec();
                }
            }

            return next();
        }

        const cachedAuth = await redis.exists(rKey.employee(cfAuthHeader));
        if (cachedAuth) {
            const discordUser = await getDiscordUser(cfAuthHeader);
            if (discordUser) {
                req.cfAuth = discordUser;
                await redis.set(rKey.employeeLastOnline(discordUser?.userId ?? ''), nowIso);
                return next();
            }
        }

        try {
            const { data } = await axios.get('https://canobal.cloudflareaccess.com/cdn-cgi/access/get-identity', {
                headers: { cookie: "CF_Authorization=" + cfAuthHeader }
            });
            req.cfAuth = await getDiscordUser(data?.custom.id);
            if (!req.cfAuth) {
                throw new HqError('Employee not found', 0, 404);
            }
            await redis.set(rKey.employeeLastOnline(req.cfAuth?.userId ?? ''), nowIso);
        } catch (err) {
            if (err instanceof HqError) {
                throw err;
            }
            logger.error(err);
            throw new HqError('Auth not valid.', 105, 401);
        }
        return next();
    });
}

export default cfAuth;
import axios from 'axios';
import { createPublicKey, KeyObject } from 'crypto';
import jwt, { JwtPayload } from 'jsonwebtoken';
import logger from '../../common/logger';

// Tokens are the CF_Authorization JWTs issued by Cloudflare Access, signed with the team's Access keys.
const TEAM_DOMAIN = 'https://canobal.cloudflareaccess.com';
const JWKS_URL = `${TEAM_DOMAIN}/cdn-cgi/access/certs`;
const ISSUER = TEAM_DOMAIN;
const AUDIENCE = process.env.CF_ACCESS_AUD; // Access application AUD tag
let warnedNoAudience = false;
const JWKS_TTL_MS = 60 * 60 * 1000;
const JWKS_MIN_REFETCH_MS = 30 * 1000;

type Jwk = { kid?: string; [key: string]: unknown };

let keyCache = new Map<string, KeyObject>();
let fetchedAt = 0;
let inflight: Promise<void> | null = null;

async function refreshKeys(): Promise<void> {
    if (!inflight) {
        inflight = (async () => {
            const { data } = await axios.get<{ keys: Jwk[] }>(JWKS_URL, { timeout: 5000 });
            const next = new Map<string, KeyObject>();
            for (const jwk of data.keys ?? []) {
                if (jwk.kid) next.set(jwk.kid, createPublicKey({ key: jwk as any, format: 'jwk' }));
            }
            keyCache = next;
            fetchedAt = Date.now();
        })().finally(() => { inflight = null; });
    }
    return inflight;
}

async function getKey(kid: string | undefined): Promise<KeyObject> {
    if (!kid) throw new Error('Token has no kid');
    const stale = Date.now() - fetchedAt > JWKS_TTL_MS;
    if (stale) await refreshKeys();
    let key = keyCache.get(kid);
    // Unknown kid: the signing key may have rotated. Refetch, but rate-limited.
    if (!key && Date.now() - fetchedAt > JWKS_MIN_REFETCH_MS) {
        await refreshKeys();
        key = keyCache.get(kid);
    }
    if (!key) throw new Error('Unknown signing key');
    return key;
}

/**
 * Verifies a Cloudflare Access JWT against the team's published keys (JWKS_URL).
 * Throws if the signature, expiry, issuer or audience is invalid.
 */
async function verifyCfAccessToken(token: string): Promise<JwtPayload> {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || typeof decoded === 'string') throw new Error('Malformed token');
    const key = await getKey(decoded.header.kid);
    if (!AUDIENCE && !warnedNoAudience) {
        warnedNoAudience = true;
        logger.warn('CF_ACCESS_AUD is not set; Access token audience is NOT being checked');
    }
    const payload = jwt.verify(token, key, {
        algorithms: ['RS256'],
        issuer: ISSUER,
        ...(AUDIENCE ? { audience: AUDIENCE } : {})
    });
    if (typeof payload === 'string') throw new Error('Unexpected payload');
    return payload;
}

export default verifyCfAccessToken;

import logger from '../../logger';
import redis from '../../redisClient';
import rKey from '../../redisKeys';
import { userDb } from '../connections';
import LoginToken from '../userModels/loginToken';
import { Op } from 'sequelize';

const MIGRATION_KEY = rKey.schemaMigrations('remove-private-ips-login-tokens');
const MIGRATION_RUNNING_VALUE = 'running';
const MIGRATION_DONE_VALUE = 'done';
const MIGRATION_LOCK_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Normalizes IP addresses by removing IPv4-mapped IPv6 prefix
 * (::ffff:1.2.3.4 -> 1.2.3.4)
 */
function normalizeIp(ip: string): string {
    if (ip.startsWith('::ffff:')) {
        return ip.substring(7); // Remove '::ffff:' prefix
    }
    if (ip.startsWith('[::ffff:') && ip.endsWith(']')) {
        return ip.substring(8, ip.length - 1); // Remove '[::ffff:' and ']'
    }
    return ip;
}

/**
 * Checks if an IP address is private/internal
 * Private ranges:
 * - 10.0.0.0/8 (10.0.0.0 to 10.255.255.255)
 * - 172.16.0.0/12 (172.16.0.0 to 172.31.255.255)
 * - 192.168.0.0/16 (192.168.0.0 to 192.168.255.255)
 * - 127.0.0.0/8 (127.0.0.0 to 127.255.255.255) - loopback
 * - 169.254.0.0/16 (169.254.0.0 to 169.254.255.255) - link-local
 */
function isPrivateIp(ip: string): boolean {
    const normalized = normalizeIp(ip);
    
    // Only check IPv4 addresses
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const match = normalized.match(ipv4Regex);
    if (!match) {
        // Not a valid IPv4 address, assume it's not private (could be IPv6)
        return false;
    }

    const octets = match.slice(1, 5).map(Number);

    // 10.0.0.0/8
    if (octets[0] === 10) {
        return true;
    }

    // 172.16.0.0/12
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) {
        return true;
    }

    // 192.168.0.0/16
    if (octets[0] === 192 && octets[1] === 168) {
        return true;
    }

    // 127.0.0.0/8 (loopback)
    if (octets[0] === 127) {
        return true;
    }

    // 169.254.0.0/16 (link-local)
    if (octets[0] === 169 && octets[1] === 254) {
        return true;
    }

    return false;
}

export default async function removePrivateIpsFromLoginTokens(): Promise<boolean> {
    let lockAcquired = false;
    let completed = false;
    
    try {
        const cachedValue = await redis.get(MIGRATION_KEY);
        if (cachedValue === MIGRATION_DONE_VALUE) {
            return false;
        }
        if (cachedValue === MIGRATION_RUNNING_VALUE) {
            logger.info('removePrivateIpsFromLoginTokens: migration already running elsewhere');
            return false;
        }

        const setResult = await redis.set(MIGRATION_KEY, MIGRATION_RUNNING_VALUE, {
            NX: true,
            PX: MIGRATION_LOCK_TTL_MS
        });
        if (!setResult) {
            const latestValue = await redis.get(MIGRATION_KEY);
            if (latestValue === MIGRATION_DONE_VALUE) {
                return false;
            }
            logger.info('removePrivateIpsFromLoginTokens: unable to acquire migration lock');
            return false;
        }

        lockAcquired = true;

        // Find all login tokens with IP addresses
        const tokensWithIps = await LoginToken.findAll({
            where: {
                ipAddress: { [Op.ne]: null }
            },
            attributes: ['token', 'ipAddress']
        });

        logger.info(`removePrivateIpsFromLoginTokens: found ${tokensWithIps.length} tokens with IP addresses`);

        let updatedCount = 0;
        const batchSize = 1000;
        const tokensToUpdate: string[] = [];

        for (const token of tokensWithIps) {
            if (!token.ipAddress) continue;

            const normalized = normalizeIp(token.ipAddress);
            if (isPrivateIp(normalized)) {
                tokensToUpdate.push(token.token);
            }
        }

        logger.info(`removePrivateIpsFromLoginTokens: found ${tokensToUpdate.length} tokens with private/internal IPs to nullify`);

        // Update in batches
        for (let i = 0; i < tokensToUpdate.length; i += batchSize) {
            const batch = tokensToUpdate.slice(i, i + batchSize);
            await LoginToken.update(
                { ipAddress: null },
                {
                    where: {
                        token: { [Op.in]: batch }
                    }
                }
            );
            updatedCount += batch.length;
            logger.info(`removePrivateIpsFromLoginTokens: updated batch ${Math.floor(i / batchSize) + 1}, ${updatedCount}/${tokensToUpdate.length} total`);
        }

        logger.info(`removePrivateIpsFromLoginTokens: migration completed. Nullified ${updatedCount} private/internal IPs`);

        await redis.set(MIGRATION_KEY, MIGRATION_DONE_VALUE);
        completed = true;
        return updatedCount > 0;
    } catch (error) {
        if (lockAcquired) {
            await redis.del(MIGRATION_KEY);
        }
        logger.error({ error }, 'removePrivateIpsFromLoginTokens: migration failed');
        throw error;
    } finally {
        if (lockAcquired && !completed) {
            await redis.del(MIGRATION_KEY);
        }
    }
}


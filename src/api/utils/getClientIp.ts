import { Request } from 'express';

/**
 * Extracts the real client IP address from request headers.
 * Prioritizes Cloudflare's cf-connecting-ip header, then DigitalOcean's do-connecting-ip,
 * then x-forwarded-for (which can be spoofed or contain proxy IPs).
 * 
 * @param reqOrHeaders Express request object or headers object
 * @returns The client IP address, or null if not found
 */
export function getClientIp(reqOrHeaders: Request | { headers: Request['headers']; ip?: string }): string | null {
    // Extract headers - handle both Request object and plain headers object
    let headers: Request['headers'];
    let fallbackIp: string | undefined = undefined;
    
    if ('headers' in reqOrHeaders) {
        headers = reqOrHeaders.headers;
        if ('ip' in reqOrHeaders) {
            fallbackIp = reqOrHeaders.ip;
        } else if ('ip' in (reqOrHeaders as Request)) {
            fallbackIp = (reqOrHeaders as Request).ip;
        }
    } else {
        headers = reqOrHeaders as Request['headers'];
    }

    // Cloudflare provides the real client IP in this header
    const cfIp = headers['cf-connecting-ip'];
    if (cfIp && typeof cfIp === 'string') {
        return normalizeIp(cfIp.trim());
    }

    // DigitalOcean provides the real client IP in this header
    const doIp = headers['do-connecting-ip'];
    if (doIp && typeof doIp === 'string') {
        return normalizeIp(doIp.trim());
    }

    // x-forwarded-for can contain multiple IPs (client, proxy1, proxy2, ...)
    // The first IP is usually the original client, but it can be spoofed
    const xForwardedFor = headers['x-forwarded-for'];
    if (xForwardedFor && typeof xForwardedFor === 'string') {
        // Take the first IP from the comma-separated list
        const firstIp = xForwardedFor.split(',')[0].trim();
        if (firstIp) {
            return normalizeIp(firstIp);
        }
    }

    // Fallback to Express's req.ip (may be the proxy IP)
    if (fallbackIp) {
        return normalizeIp(fallbackIp);
    }

    return null;
}

/**
 * Normalizes IP addresses:
 * - Converts IPv4-mapped IPv6 addresses (::ffff:1.2.3.4) to IPv4 (1.2.3.4)
 * - Returns the IP as-is if already normalized
 */
function normalizeIp(ip: string): string {
    // Handle IPv4-mapped IPv6 addresses (::ffff:1.2.3.4 -> 1.2.3.4)
    if (ip.startsWith('::ffff:')) {
        return ip.substring(7); // Remove '::ffff:' prefix
    }
    // Handle IPv6-mapped format with brackets [::ffff:1.2.3.4]
    if (ip.startsWith('[::ffff:') && ip.endsWith(']')) {
        return ip.substring(8, ip.length - 1); // Remove '[::ffff:' and ']'
    }
    return ip;
}


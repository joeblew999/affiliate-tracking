// Salted SHA-256 of a visitor IP. Raw IPs are never stored.
import type { AffiliateEnv } from './types.ts';

export async function hashIp(ip: string | null | undefined, salt: string | undefined): Promise<string | null> {
    if (!ip) return null;
    const data = new TextEncoder().encode(ip + (salt || ''));
    const buf = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(buf)]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

export function requestIpHash(request: Request, env: AffiliateEnv | undefined): Promise<string | null> {
    return hashIp(request.headers.get('cf-connecting-ip'), env?.AFFILIATE_IP_SALT);
}

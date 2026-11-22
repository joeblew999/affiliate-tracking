import type { AffiliateEnv } from './types.ts';
export declare function hashIp(ip: string | null | undefined, salt: string | undefined): Promise<string | null>;
export declare function requestIpHash(request: Request, env: AffiliateEnv | undefined): Promise<string | null>;

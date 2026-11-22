import type { AffiliateEnv } from './types.ts';
export declare function attachAffiliateAttribution(params: URLSearchParams, request: Request, env: AffiliateEnv, { promoCode, userId }?: {
    promoCode?: string;
    userId?: string;
}): Promise<void>;

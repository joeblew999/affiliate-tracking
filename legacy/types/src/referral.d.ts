import type { AffiliateEnv, AffiliateReferral, DbEnv } from './types.ts';
export declare function validUserId(userId: unknown): userId is string;
export type RequestOrHeaders = Request | Headers | {
    headers: Headers | HeadersInit;
} | HeadersInit;
export declare function recordSignupReferral(requestOrHeaders: RequestOrHeaders, env: AffiliateEnv, userId: unknown): Promise<AffiliateReferral | null>;
export declare function referralFor(env: AffiliateEnv, userId: unknown): Promise<AffiliateReferral | null>;
export declare function settleReferral(env: DbEnv, { userId, affiliateId, source, stripeCustomerId, at }: {
    userId: string;
    affiliateId: number;
    source?: string | null;
    stripeCustomerId?: string | null;
    at: number;
}): Promise<void>;

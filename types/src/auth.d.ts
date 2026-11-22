import type { AffiliateAuth, AffiliatesRow, DbEnv } from './types.ts';
export declare function validateAuth(auth: unknown): AffiliateAuth | null;
export declare function bindAuth(request: Request, auth: AffiliateAuth | null): void;
export declare function authFor(request: Request): AffiliateAuth | null;
export type IdentityAffiliate = Pick<AffiliatesRow, 'id' | 'code' | 'name' | 'email' | 'commission_pct' | 'status' | 'stripe_account_id' | 'user_id'>;
export declare function affiliateForIdentity(env: DbEnv, raw: unknown): Promise<IdentityAffiliate | null>;

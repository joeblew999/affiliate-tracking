import type { AffiliateEnv } from './types.ts';
export declare function holdDays(env: AffiliateEnv | undefined): number | null;
export declare function releaseHeldConversions(env: AffiliateEnv, now?: number): Promise<number>;

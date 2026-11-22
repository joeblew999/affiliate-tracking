import type { AffiliateEnv, ConversionsRow, DbEnv } from './types.ts';
export declare function payoutCurrency(env: AffiliateEnv | undefined): string;
export declare function convertedCommission(env: AffiliateEnv, { payment_intent: paymentIntent, currency, commission_cents: commission }: Pick<ConversionsRow, 'payment_intent' | 'currency' | 'commission_cents'>, target: string): Promise<{
    cents: number;
    source: string;
} | null>;
export declare function settleApprovedCommissions(env: DbEnv, affiliateId?: number | null): Promise<void>;

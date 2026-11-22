import type { AffiliateEnv, AffiliatesRow, StripeEvent, StripeObject } from './types.ts';
export declare const DEFAULT_RECURRING_MONTHS = 12;
export declare function recurringMonths(affiliate: Pick<AffiliatesRow, 'recurring_months'> | null | undefined, env: AffiliateEnv | undefined): number;
export declare function addMonths(timestamp: number, months: number): number;
export declare function invoiceSubscription(invoice: StripeObject | null | undefined): string | null;
export declare function invoicePaymentIntent(invoice: StripeObject | null | undefined, env: AffiliateEnv): Promise<string | null>;
export declare function recordInvoicePayment(invoice: StripeObject | null | undefined, event: StripeEvent | null | undefined, env: AffiliateEnv): Promise<{
    affiliate_id: number;
    commission_cents: number;
} | null>;

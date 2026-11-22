import type { AffiliatesRow, CommissionRulesRow, DbEnv } from './types.ts';
export declare function pickRule(rules: readonly CommissionRulesRow[], { affiliateId, productIds, salesThisMonth }: {
    affiliateId: number;
    productIds: readonly string[];
    salesThisMonth: number;
}): CommissionRulesRow | null;
export interface CommissionItem {
    product_id: string | null;
    price_id: string | null;
    quantity: number;
    amount_cents: number | null | undefined;
}
export interface CommissionLine {
    rule_id: string | null;
    product_id: string | null;
    base_cents: number;
    commission_cents: number;
}
export declare function computeCommission(env: DbEnv, { affiliate, amountCents, currency, items, customerEmail, at }: {
    affiliate: Pick<AffiliatesRow, 'id' | 'commission_pct'>;
    amountCents: number;
    currency: string | null;
    items: readonly CommissionItem[];
    customerEmail?: string | null;
    at: number;
}): Promise<{
    commission: number;
    pct: number | null;
    detail: CommissionLine[] | null;
}>;

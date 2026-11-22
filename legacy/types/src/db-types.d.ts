export interface AffiliateIpHashesRow {
    affiliate_id: number;
    ip_hash: string;
    last_seen_at: number;
}
export interface AffiliatesRow {
    id: number;
    email: string;
    name: string | null;
    code: string;
    status: string;
    commission_pct: number;
    promo_code_id: string | null;
    stripe_account_id: string | null;
    created_at: number;
    source: string | null;
    message: string | null;
    applied_at: number | null;
    terms_version: string | null;
    terms_accepted_at: number | null;
    session_version: number;
    promo_code: string | null;
    status_change_id: string | null;
    status_change_target: string | null;
    review_required: number;
    recurring_months: number | null;
    user_id: string | null;
}
export interface ClicksRow {
    id: number;
    affiliate_id: number;
    ip_hash: string | null;
    created_at: number;
    link_id: string | null;
    country: string | null;
    device: string | null;
    referrer_host: string | null;
}
export interface CommissionRulesRow {
    id: string;
    affiliate_id: number | null;
    product_id: string | null;
    kind: string;
    percent: number | null;
    fixed_cents: number | null;
    currency: string | null;
    min_monthly_sales: number;
    cap_per_customer_cents: number | null;
    active: number;
    created_at: number;
}
export interface ConversionsRow {
    id: number;
    affiliate_id: number;
    stripe_session_id: string;
    stripe_event_id: string | null;
    payment_intent: string | null;
    customer_email: string | null;
    amount_cents: number;
    commission_cents: number;
    status: string;
    created_at: number;
    paid_at: number | null;
    payout_id: number | null;
    currency: string | null;
    customer_country: string | null;
    commission_pct: number | null;
    items_json: string;
    approved_at: number | null;
    fraud_reason: string | null;
    link_id: string | null;
    user_id: string | null;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    stripe_invoice_id: string | null;
    kind: string;
    payout_currency: string | null;
    payout_cents: number | null;
    fx_source: string | null;
    fx_checked_at: number | null;
    commission_detail: string | null;
    bonus_note: string | null;
}
export interface LinksRow {
    id: string;
    affiliate_id: number;
    slug: string;
    destination: string;
    campaign: string | null;
    status: string;
    created_at: number;
}
export interface PayoutsRow {
    id: number;
    affiliate_id: number;
    amount_cents: number;
    stripe_transfer_id: string | null;
    status: string;
    created_at: number;
    batch_key: string | null;
    stripe_account_id: string | null;
    transfer_started_at: number | null;
    currency: string;
    paid_at: number | null;
}
export interface ReferralsRow {
    id: string;
    user_id: string;
    affiliate_id: number;
    source: string;
    stripe_customer_id: string | null;
    created_at: number;
    converted_at: number | null;
}
export interface RefundedPaymentsRow {
    payment_intent: string;
}
export interface UsedAffiliateMagicLinksRow {
    jti: string;
    expires_at: number;
}

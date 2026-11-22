// Public types of cf-affiliate. Row types come from the schema (db-types.ts).
export type * from './db-types.ts';

export interface AffiliateEnv {
    DB?: D1Database;
    ADMIN_TOKEN?: string;
    ADMIN_EMAIL?: string;
    AFFILIATE_SESSION_SECRET?: string;
    AFFILIATE_REF_COOKIE?: string;
    AFFILIATE_REF_LEGACY_COOKIE?: string;
    AFFILIATE_IP_SALT?: string;
    AFFILIATE_DEV_MODE?: string;
    AFFILIATE_TERMS_VERSION?: string;
    /** Whole days before a pending conversion is approved automatically. Unset: manual approval only. */
    AFFILIATE_HOLD_DAYS?: string;
    /** Path prefix of short links. Default /r/. */
    AFFILIATE_LINK_PREFIX?: string;
    /** Origin short links are shown under, e.g. https://go.example.com. Default: SITE_URL. */
    AFFILIATE_LINK_BASE_URL?: string;
    /** Months after the first sale that renewals earn commission. Default 12; 0 = first payment only. */
    AFFILIATE_RECURRING_MONTHS?: string;
    /** Currency payouts are sent in: your Stripe settlement currency. Default usd. */
    AFFILIATE_PAYOUT_CURRENCY?: string;
    /** Smallest amount owed (minor units) that is paid out; less waits for a later run. */
    AFFILIATE_MIN_PAYOUT_CENTS?: string;
    /** Optional Workers Analytics Engine binding; every click is also written there. */
    AFFILIATE_ANALYTICS?: { writeDataPoint(point: { indexes?: string[]; blobs?: string[]; doubles?: number[] }): void };
    AFFILIATE_PUBLIC_LIMITER?: {
        limit(options: { key: string }): Promise<{ success: boolean }>;
    };
    STRIPE_SECRET_KEY?: string;
    BREVO_API_KEY?: string;
    EMAIL_URL?: string;
    EMAIL_AUTH_HEADER?: string;
    EMAIL_SENDER_NAME?: string;
    EMAIL_SENDER_ADDRESS?: string;
    SITE_URL?: string;
}

/** The env once the DB binding has been checked. */
export type DbEnv = AffiliateEnv & { DB: D1Database };

export interface AffiliateExecutionContext {
    waitUntil(promise: Promise<unknown>): void;
}

export interface AffiliateRouteContext {
    request: Request;
    env: AffiliateEnv;
    ctx?: AffiliateExecutionContext;
    params: Record<string, string | string[]>;
}

export type AffiliateRoute = [
    method: string,
    path: string,
    handler: (context: AffiliateRouteContext) => Response | Promise<Response>,
];

export interface AffiliateIdentity {
    /** Your auth's user id. */
    userId: string;
    /** Verified email, used to match the affiliate on their first sign-in. */
    email?: string | null;
}

export interface AffiliateAuth {
    /** The signed-in user, or null. */
    affiliate?: (request: Request, env: AffiliateEnv) => AffiliateIdentity | null | Promise<AffiliateIdentity | null>;
    /** Whether the signed-in user may use the admin API and dashboard. */
    admin?: (request: Request, env: AffiliateEnv) => boolean | Promise<boolean>;
}

export interface AdminDashboardAppearance {
    brandName?: string;
    logoUrl?: string;
    stylesheets?: readonly string[];
    fontOrigins?: readonly string[];
    title?: string;
}

export type StripeReference = string | { id: string };

/** A parsed JSON request body. Untrusted: each handler checks the fields it reads. */
export type JsonObject = Record<string, any>;

/** A Stripe API object, read field by field where it is used. */
export type StripeObject = Record<string, any>;

export interface CheckoutLineItem {
    description?: string | null;
    quantity?: number | null;
    price?: { product?: string | { id: string; name?: string } | null; nickname?: string | null } | null;
}

export interface CheckoutSession {
    id: string;
    metadata?: Record<string, string> | null;
    discounts?: readonly { promotion_code?: StripeReference | null }[] | null;
    total_details?: { amount_discount?: number } | null;
    allow_promotion_codes?: boolean | null;
    amount_total?: number | null;
    payment_intent?: StripeReference | null;
    customer?: StripeReference | null;
    subscription?: StripeReference | null;
    invoice?: StripeReference | null;
    currency?: string | null;
    customer_details?: { email?: string | null; address?: { country?: string | null } | null } | null;
    line_items?: { data?: readonly CheckoutLineItem[] } | null;
}

export interface StripeEvent {
    id?: string;
    created?: number;
    type?: string;
    data?: { object?: unknown };
}

export interface AffiliateReferral {
    id: string;
    user_id: string;
    affiliate_id: number;
    source: 'signup' | 'promo_code' | 'checkout';
    converted_at: number | null;
    code: string;
    promo_code_id: string | null;
}


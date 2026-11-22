import { defineEnv, number, string, url } from "void/env";

export default defineEnv({
  // The secret the host app sends with every call to /api/host/* (src/host-api.ts). The same value
  // is in the host's own env.
  AFFILIATES_HOST_TOKEN: string(),
  // The host's site: where referral links send visitors (routes/r/[slug].ts), and where people sign
  // in (its Better Auth OAuth provider: auth.ts).
  HOST_SITE_URL: url(),
  // This service's client secret with the host's OAuth provider. The host keeps its hash
  // (scripts/oauth-client.ts registers it).
  AFFILIATES_OAUTH_SECRET: string(),
  // The parent domain the referral cookie is set for, so the host's site receives it, e.g.
  // ".example.com". Unset locally: localhost shares cookies across ports.
  AFFILIATES_COOKIE_DOMAIN: string().optional(),
  // Salt for hashing visitor IPs (src/ip.ts). Any long random value; changing it resets the
  // one-click-per-visitor-per-day count.
  AFFILIATES_IP_SALT: string(),
  // Stripe: the platform's secret key (line items, promotion codes, payouts). Stripe's events come
  // through the host (its Better Auth Stripe plugin's onEvent: routes/api/host/stripe-event.ts).
  STRIPE_SECRET_KEY: string().optional(),
  // Months after a subscription's first sale that its renewals earn commission, unless a partner
  // has their own (src/renewals.ts). Default 12; 0: the first payment only.
  AFFILIATES_RECURRING_MONTHS: number().optional(),
  // Days a sale waits before it's approved automatically (crons/daily.ts). Unset: an admin approves
  // every sale.
  AFFILIATES_HOLD_DAYS: number().optional(),
  // The currency payouts are sent in: the platform's Stripe settlement currency. Default usd.
  AFFILIATES_PAYOUT_CURRENCY: string().default("usd"),
  // The least a partner is paid out (in the payout currency's minor units); less waits for a later
  // run. Default 0: everything owed.
  AFFILIATES_MIN_PAYOUT_CENTS: number().default(0),
  // A Stripe coupon (the buyer discount). With it, each partner gets a promotion code for it when
  // approved; checkouts through them get the discount.
  AFFILIATES_COUPON_ID: string().optional(),
});

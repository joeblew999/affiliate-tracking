import { defineEnv, string, url } from "void/env";

export default defineEnv({
  // The secret the host app sends with every call to /api/host/* (src/host-api.ts). The same value
  // is in the host's own env.
  AFFILIATES_HOST_TOKEN: string(),
  // The host's site: where referral links send visitors (routes/r/[slug].ts).
  HOST_SITE_URL: url(),
  // The parent domain the referral cookie is set for, so the host's site receives it, e.g.
  // ".example.com". Unset locally: localhost shares cookies across ports.
  AFFILIATES_COOKIE_DOMAIN: string().optional(),
  // Salt for hashing visitor IPs (src/ip.ts). Any long random value; changing it resets the
  // one-click-per-visitor-per-day count.
  AFFILIATES_IP_SALT: string(),
  // Stripe: the platform's secret key (line items, promotion codes, payouts) and the signing secret
  // of this app's own webhook endpoint (/api/stripe/webhook).
  STRIPE_SECRET_KEY: string().optional(),
  STRIPE_WEBHOOK_SECRET: string(),
});

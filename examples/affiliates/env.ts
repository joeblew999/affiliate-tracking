import { defineEnv, number, string, url } from "void/env";

export default defineEnv({
  // The secret the host app sends with every call to /api/host/* (src/host-api.ts). The same value
  // is in the host's own env.
  AFFILIATES_HOST_TOKEN: string(),
  // The host's site: where referral links send visitors (routes/r/[slug].ts), and where people sign
  // in (src/user.ts).
  HOST_SITE_URL: url(),
  // Sent with every call to the hub (the hub (the repo's root): its middleware/01.workers.ts checks it). The same
  // value is in the hub's env and every other worker's.
  HUB_TOKEN: string(),
  // This service's own address: where the hub wakes it when a stream it follows has something new
  // (src/hub.ts).
  AFFILIATES_SITE_URL: url().default("http://localhost:5174"),
  // The parent domain the referral cookie is set for, so the host's site receives it, e.g.
  // ".example.com". Unset locally: localhost shares cookies across ports.
  AFFILIATES_COOKIE_DOMAIN: string().optional(),
  // Salt for hashing visitor IPs (src/ip.ts). Any long random value; changing it resets the
  // one-click-per-visitor-per-day count.
  AFFILIATES_IP_SALT: string(),
  // Stripe: two accounts of the one business, since Stripe won't let one account both use
  // Managed Payments and pay partners through Connect (docs.stripe.com/payments/managed-payments/
  // eligibility, read 2026-11-23). Without them: no discount codes, no settled exchange rates, and
  // every payout is manual.
  // The selling account (the host's): reading its sales, refunds and settled exchange rates, and
  // making partners' discount codes. Its key needs read access, and write access to promotion codes.
  STRIPE_SALES_KEY: string().optional(),
  // The payouts account: a Connect platform holding no sales. Partners' Stripe accounts, the money
  // added to it from the business's bank before each payout (top-ups), and the transfers.
  STRIPE_PAYOUTS_KEY: string().optional(),
  // The signing secret of the payouts account's webhook (/api/stripe/payouts), which says when
  // money added to it has arrived (topup.succeeded).
  STRIPE_PAYOUTS_WEBHOOK_SECRET: string().optional(),
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
  // Set (to anything) on a demo site only: admins get a "Reset demo" button that deletes everything
  // in the program and loads the demo again (src/demo-reset.ts). Never on a real program.
  AFFILIATES_DEMO: string().optional(),
  // Pins the service's clock (src/clock.ts) to this instant (ISO 8601), for tests and the local
  // demo: the demo fixtures are dated from it. Unset in production: the real time.
  AFFILIATES_NOW: string().optional(),
  // The real time (ms) at which the clock reads AFFILIATES_NOW; it runs on from there.
  AFFILIATES_NOW_FROM: number().optional(),
});

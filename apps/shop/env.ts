import { defineEnv, string, url } from "void/env";

export default defineEnv({
  // Sent with every call to the affiliate service (its middleware/01.host-api.ts checks it). The
  // same value is in that app's env.
  AFFILIATES_HOST_TOKEN: string(),
  // Comma-separated emails that get the admin role when they sign up (auth.ts). Admins run the
  // affiliate program.
  ADMIN_EMAILS: string().default(""),
  // Stripe, for the shop's subscription (Better Auth's Stripe plugin). Without a key the shop runs
  // with no payments: sign-in and the affiliate program still work.
  STRIPE_SECRET_KEY: string().optional(),
  STRIPE_WEBHOOK_SECRET: string().optional(),
  // The price of the shop's one plan, "pro".
  STRIPE_PRO_PRICE_ID: string().optional(),
  // Where the affiliate service's pages are, for the shop's "Partner program" link.
  AFFILIATES_SITE_URL: url().default("http://localhost:5174"),
});

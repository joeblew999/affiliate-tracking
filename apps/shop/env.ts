import { defineEnv, string } from "void/env";

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
  // The domain the sign-in cookie is set for, so the affiliate service on a subdomain of it gets the
  // cookie too: e.g. shop.example.com, with the service at affiliates.shop.example.com. Unset (local
  // dev, where both are on localhost): the cookie is the shop's own.
  AUTH_COOKIE_DOMAIN: string().optional(),
});

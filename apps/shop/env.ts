import { defineEnv, string, url } from "void/env";

export default defineEnv({
  // Sent with every call to the affiliate service (its middleware/01.host-api.ts checks it). The
  // same value is in that app's env.
  AFFILIATES_HOST_TOKEN: string(),
  // Comma-separated emails that get the admin role when they sign up (auth.ts). Admins run the
  // affiliate program.
  ADMIN_EMAILS: string().default(""),
  // Stripe, the selling account (Managed Payments: Stripe sells the tickets and handles their tax),
  // and its webhook's signing secret. Without a key the shop runs with no payments: sign-in and the
  // affiliate program still work.
  STRIPE_SECRET_KEY: string().optional(),
  STRIPE_WEBHOOK_SECRET: string().optional(),
  // The parent domain the sign-in cookie is set for, so the affiliate service on a subdomain
  // receives it, e.g. "shop.example.com". Unset locally: localhost shares cookies across ports.
  AUTH_COOKIE_DOMAIN: string().optional(),
  // Where the affiliate service's pages are: the shop's "Partner program" link, and the origin its
  // pages call this Better Auth from (auth.ts).
  AFFILIATES_SITE_URL: url().default("http://localhost:5174"),
});

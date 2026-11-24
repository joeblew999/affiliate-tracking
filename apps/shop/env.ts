import { defineEnv, string, url } from "void/env";

export default defineEnv({
  // Sent with every call to the affiliate service (its middleware/01.host-api.ts checks it). The
  // same value is in that app's env.
  AFFILIATES_HOST_TOKEN: string(),
  // Sent with every call to the hub (apps/hub: its middleware/01.workers.ts checks it). The same
  // value is in the hub's env and every other worker's.
  HUB_TOKEN: string(),
  // The shop's own address: where the hub wakes it when a stream it follows has something new
  // (src/hub.ts), and what the links in its emails start with.
  SHOP_SITE_URL: url().default("http://localhost:5173"),
  // Comma-separated emails that get the admin role when they sign up (auth.ts). Admins run the
  // affiliate program.
  ADMIN_EMAILS: string().default(""),
  // Stripe, the selling account (Managed Payments: Stripe sells the tickets and handles their tax),
  // and its webhook's signing secret. Without a key the shop runs with no payments: sign-in and the
  // affiliate program still work.
  STRIPE_SECRET_KEY: string().optional(),
  STRIPE_WEBHOOK_SECRET: string().optional(),
  // Signs the unsubscribe link in each event email (src/email-links.ts). Any long random value;
  // changing it makes the links already sent stop working.
  EMAIL_LINK_SECRET: string(),
  // The parent domain the sign-in cookie is set for, so the affiliate service on a subdomain
  // receives it, e.g. "shop.example.com". Unset locally: localhost shares cookies across ports.
  AUTH_COOKIE_DOMAIN: string().optional(),
  // Where the affiliate service's pages are: the shop's "Partner program" link, and the origin its
  // pages call this Better Auth from (auth.ts).
  AFFILIATES_SITE_URL: url().default("http://localhost:5174"),
});

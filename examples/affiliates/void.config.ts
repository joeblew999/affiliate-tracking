import { defineConfig } from "void/config";

export default defineConfig({
  routing: { typedRoutes: true },
  // Every page: its language, and the viewport tag, without which phones render the page at
  // desktop width and shrink it.
  head: {
    titleTemplate: "%s | Partner program",
    htmlAttrs: { lang: "en" },
    meta: [
      { charset: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
    ],
  },
  // Column names in snake_case from the schema's camelCase keys (db/schema.ts).
  database: { casing: "snake_case" },
  cloudflare: {
    name: "affiliates",
    // HOST: the shop: who is signed in, and its Better Auth at /api/auth (src/user.ts).
    // HUB: the streams (the hub, at the repo's root), through its client (src/hub.ts).
    services: [
      { binding: "HOST", service: "shop" },
      { binding: "HUB", service: "durable-streams" },
    ],
    // Deployed at: a subdomain of the shop's, so the referral cookie reaches the shop (README, "Two addresses").
    routes: [{ pattern: "affiliates.shop.ubuntusoftware.net", custom_domain: true }],
    // Only there: no workers.dev address and no preview URLs (as set in Cloudflare).
    workers_dev: false,
    preview_urls: false,
  },
});

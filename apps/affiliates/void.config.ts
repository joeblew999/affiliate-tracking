import { defineConfig } from "void/config";

export default defineConfig({
  routing: { typedRoutes: true },
  // Column names in snake_case from the schema's camelCase keys (db/schema.ts).
  database: { casing: "snake_case" },
  cloudflare: {
    name: "affiliates",
    // HOST: the app whose Better Auth signs people in (src/user.ts asks it who a session cookie
    // belongs to). Here the example shop, apps/shop; a deployment for another app names that app's
    // Worker instead.
    services: [{ binding: "HOST", service: "shop" }],
    // Deployed at: a subdomain of the shop's, so they share its cookies (README, "Two addresses").
    routes: [{ pattern: "affiliates.shop.ubuntusoftware.net", custom_domain: true }],
    // Only there: no workers.dev address and no preview URLs (as set in Cloudflare).
    workers_dev: false,
    preview_urls: false,
  },
});

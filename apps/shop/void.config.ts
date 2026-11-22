import { defineConfig } from "void/config";

export default defineConfig({
  routing: { typedRoutes: true },
  // AFFILIATES: the affiliate service (apps/affiliates), called through its client.
  cloudflare: {
    name: "shop",
    services: [{ binding: "AFFILIATES", service: "affiliates" }],
    // Deployed at (Cloudflare manages its DNS record and certificate):
    routes: [{ pattern: "shop.ubuntusoftware.net", custom_domain: true }],
    // Only there: no workers.dev address and no preview URLs (as set in Cloudflare).
    workers_dev: false,
    preview_urls: false,
  },
});

import { defineConfig } from "void/config";

export default defineConfig({
  routing: { typedRoutes: true },
  // Every page: its language, and the viewport tag, without which phones render the page at
  // desktop width and shrink it.
  head: {
    titleTemplate: "%s | Example shop",
    htmlAttrs: { lang: "en" },
    meta: [
      { charset: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
    ],
  },
  // Who the shop's emails (events going on sale) are from. Deploying sets up sending from this
  // domain on the Cloudflare account; locally it's the sender in the dev inbox.
  email: { from: "Example shop <events@shop.ubuntusoftware.net>" },
  // Email on, though no file here imports void/email itself: the shop sends through the control
  // plane's wrapper (src/activity.ts), which Void's scan of the app doesn't see.
  inference: { bindings: { email: true } },
  // AFFILIATES: the affiliate service (examples/affiliates), called through its client.
  // HUB: the streams (the hub, at the repo's root), through its client (src/hub.ts).
  cloudflare: {
    name: "shop",
    services: [
      { binding: "AFFILIATES", service: "affiliates" },
      { binding: "HUB", service: "durable-streams" },
    ],
    // Deployed at (Cloudflare manages its DNS record and certificate):
    routes: [{ pattern: "shop.ubuntusoftware.net", custom_domain: true }],
    // Only there: no workers.dev address and no preview URLs (as set in Cloudflare).
    workers_dev: false,
    preview_urls: false,
  },
});

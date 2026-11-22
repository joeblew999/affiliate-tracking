import { defineConfig } from "void/config";

export default defineConfig({
  routing: { typedRoutes: true },
  // AFFILIATES: the affiliate service (apps/affiliates), called through its client.
  cloudflare: { name: "shop", services: [{ binding: "AFFILIATES", service: "affiliates" }] },
});

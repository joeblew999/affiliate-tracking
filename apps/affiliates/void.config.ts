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
  },
});

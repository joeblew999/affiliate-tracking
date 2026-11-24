import { defineConfig } from "vite-plus";
import { voidPlugin } from "void";

export default defineConfig({
  plugins: [voidPlugin()],
  environments: {
    void_worker: {
      // Found when the server starts, not on the first request that uses them (which reloads the
      // Worker mid-request, and its durable objects are unbound until it's back).
      optimizeDeps: { include: ["hono/bearer-auth", "zod"] },
    },
  },
  server: {
    // Always 5175 in development. Nobody opens it: workers reach it through their bindings.
    port: 5175,
    strictPort: true,
    // Workers reach the hub through their bindings, addressed as "hub" (client.ts). Vite's dev
    // server only answers host names it knows.
    allowedHosts: ["hub"],
  },
});

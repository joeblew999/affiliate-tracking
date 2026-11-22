import { defineConfig } from "vite-plus";
import { voidPlugin } from "void";
import { voidReact } from "@void/react/plugin";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [voidPlugin(), voidReact(), tailwindcss()],
  // The Worker's dependencies Vite otherwise finds only on the first request that uses them, then
  // reloads mid-request: bundled when the server starts instead. Only these: a package whose
  // errors the code checks (Better Auth's, Hono's) must not be bundled twice.
  environments: {
    void_worker: {
      optimizeDeps: {
        include: ["@better-auth/stripe", "stripe", "hono/utils/cookie"],
      },
    },
  },
  server: {
    // Always 5173 (the affiliate service is 5174; the tests expect both).
    port: 5173,
    strictPort: true,
    // The affiliate service asks this app who is signed in through its service binding,
    // addressed as host.internal. Vite's dev server only answers host names it knows.
    allowedHosts: ["host.internal"],
  },
});

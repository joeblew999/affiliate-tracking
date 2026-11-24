import { defineConfig } from "vite-plus";
import { voidPlugin } from "void";
import { voidReact } from "@void/react/plugin";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [voidPlugin(), voidReact(), tailwindcss()],
  // The Worker's dependencies Vite otherwise finds only on the first request that uses them, then
  // reloads mid-request: bundled when the server starts instead. Only these: a package whose
  // errors the code checks (Better Auth's, Hono's) must not be bundled twice.
  // The same in the browser: the Activity pane's (examples/activity) stream client and the
  // schema it reads events with, which Vite would otherwise find on the first page and reload it.
  optimizeDeps: {
    include: ["activity > @durable-streams/client", "zod"],
  },
  environments: {
    void_worker: {
      optimizeDeps: {
        include: ["hono/bearer-auth"],
      },
    },
  },
  server: {
    // The shop is 5173; this app is always 5174 (the tests and the shop's links expect it).
    port: 5174,
    strictPort: true,
    // The shop reaches this app through its service binding, addressed as affiliates.internal
    // (client.ts). Vite's dev server only answers host names it knows.
    allowedHosts: ["affiliates.internal"],
  },
});

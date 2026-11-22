import { defineConfig } from "vite-plus";
import { voidPlugin } from "void";
import { voidReact } from "@void/react/plugin";
import tailwindcss from "@tailwindcss/vite";

// Its own debugger port. `vp run dev` starts both apps at once; both asked for 9229, and now and then
// one crashed (EADDRINUSE) instead of moving to another port. Void reads VOID_INSPECTOR_PORT
// (void 1.11.0, dist/index.mjs; not in its docs).
process.env.VOID_INSPECTOR_PORT ??= "9231";

export default defineConfig({
  plugins: [voidPlugin(), voidReact(), tailwindcss()],
  server: {
    // The shop is 5173; this app is always 5174 (the tests and the shop's links expect it).
    port: 5174,
    strictPort: true,
    // The shop reaches this app through its service binding, addressed as affiliates.internal
    // (client.ts). Vite's dev server only answers host names it knows.
    allowedHosts: ["affiliates.internal"],
  },
});

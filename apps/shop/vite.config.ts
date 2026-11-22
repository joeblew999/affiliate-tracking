import { defineConfig } from "vite-plus";
import { voidPlugin } from "void";
import { voidReact } from "@void/react/plugin";
import tailwindcss from "@tailwindcss/vite";

// Its own debugger port. `vp run dev` starts both apps at once; both asked for 9229, and now and then
// one crashed (EADDRINUSE) instead of moving to another port. Void reads VOID_INSPECTOR_PORT
// (void 1.11.0, dist/index.mjs; not in its docs).
process.env.VOID_INSPECTOR_PORT ??= "9230";

export default defineConfig({
  plugins: [voidPlugin(), voidReact(), tailwindcss()],
  server: {
    // Always 5173 (the affiliate service is 5174; the tests expect both).
    port: 5173,
    strictPort: true,
    // The affiliate service asks this app who is signed in through its service binding,
    // addressed as host.internal. Vite's dev server only answers host names it knows.
    allowedHosts: ["host.internal"],
  },
});

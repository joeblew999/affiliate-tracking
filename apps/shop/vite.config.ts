import { defineConfig } from "vite-plus";
import { voidPlugin } from "void";
import { voidReact } from "@void/react/plugin";

export default defineConfig({
  plugins: [voidPlugin(), voidReact()],
  server: {
    // Always 5173 (the affiliate service is 5174; the tests expect both).
    port: 5173,
    strictPort: true,
    // The affiliate service asks this app who is signed in through its service binding,
    // addressed as host.internal. Vite's dev server only answers host names it knows.
    allowedHosts: ["host.internal"],
  },
});

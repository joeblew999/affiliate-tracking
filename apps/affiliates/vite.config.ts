import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";
import { voidPlugin } from "void";
import { voidReact } from "@void/react/plugin";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [voidPlugin(), voidReact(), tailwindcss()],
  // shadcn's "@/" import alias (tsconfig.json "paths" says the same for TypeScript).
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    // The shop is 5173; this app is always 5174 (the tests and the shop's links expect it).
    port: 5174,
    strictPort: true,
    // The shop reaches this app through its service binding, addressed as affiliates.internal
    // (client.ts). Vite's dev server only answers host names it knows.
    allowedHosts: ["affiliates.internal"],
  },
});

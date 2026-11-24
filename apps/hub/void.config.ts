import { defineConfig } from "void/config";

// The hub: the streams every worker of the program writes to and follows (README, "The hub"). It
// knows none of them: no bindings to other workers, no list of who follows what.
export default defineConfig({
  cloudflare: {
    name: "hub",
    // No address of its own: workers call it through their bindings to it.
    workers_dev: false,
    preview_urls: false,
  },
});

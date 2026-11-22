// Root Vite+ config: the repo's tasks, and its test projects. `vp run <task>` from anywhere.
import { defineConfig } from "vite-plus";

// legacy/: the old library, kept only to port from (plans/2026-11-22-01-void-service.md); deleted at
// step 5, so it isn't formatted or linted. README.md: the old one, rewritten at step 5.
const notChecked = ["legacy/**", "README.md"];

export default defineConfig({
  fmt: { ignorePatterns: notChecked },
  // typeAware + typeCheck: `vp check` type-checks too (as in void-fbtee's root config).
  lint: { ignorePatterns: notChecked, options: { typeAware: true, typeCheck: true } },
  run: {
    tasks: {
      // Each app's local .env, then the affiliate service's migrations on its local database. Once
      // per clone, and after pulling a new migration; safe to rerun.
      setup: { command: ["vpx scripts/setup.ts", "vp run affiliates#db:migrate"], cache: false },
      // Both apps: the shop on http://localhost:5173, the affiliate service on http://localhost:5174.
      dev: { command: "vp run -r --parallel dev", cache: false },
      // Chromium for the browser tests (once per machine).
      "install:browser": { command: "playwright install --with-deps chromium", cache: false },
      // The tests against the running apps (e2e/dev/): your `vp run dev` if it's up, else they
      // start one and stop it after.
      "test:dev": { command: "vp test run --project dev", cache: false },
    },
  },
  test: {
    projects: [
      {
        test: {
          name: "dev",
          include: ["e2e/dev/*.test.ts"],
          globalSetup: ["e2e/dev/setup.ts"],
          pool: "forks",
          fileParallelism: false,
        },
      },
    ],
  },
});

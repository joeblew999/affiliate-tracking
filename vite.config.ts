// Root Vite+ config: the repo's tasks, and its test projects. `vp run <task>` from anywhere.
import { defineConfig } from "vite-plus";

export default defineConfig({
  // typeAware + typeCheck: `vp check` type-checks too (as in void-fbtee's root config).
  lint: { options: { typeAware: true, typeCheck: true } },
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
      // Real Stripe test mode (e2e/stripe/): needs STRIPE_TEST_SECRET_KEY in the shell, and
      // `vp run dev` stopped (it starts the apps itself, with the key). Run it on demand.
      "test:stripe": { command: "vp test run --project stripe", cache: false },
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
          // Browser tests and work through queues take longer than Vitest's 5 seconds; as in
          // void-fbtee's dev-server projects.
          testTimeout: 120_000,
          hookTimeout: 120_000,
          fileParallelism: false,
        },
      },
      {
        test: {
          name: "stripe",
          include: ["e2e/stripe/*.test.ts"],
          globalSetup: ["e2e/stripe/setup.ts"],
          pool: "forks",
          testTimeout: 120_000,
          hookTimeout: 180_000,
          fileParallelism: false,
        },
      },
    ],
  },
});

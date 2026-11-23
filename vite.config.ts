// Root Vite+ config: the repo's tasks, and its test projects. `vp run <task>` from anywhere.
import { defineConfig } from "vite-plus";

export default defineConfig({
  // typeAware + typeCheck: `vp check` type-checks too (as in void-fbtee's root config).
  lint: { options: { typeAware: true, typeCheck: true } },
  run: {
    tasks: {
      // Each app's local .env, and both apps' migrations on their local databases. Once per clone,
      // and after pulling a new migration; safe to rerun.
      setup: {
        command: ["vpx scripts/setup.ts", "vp run affiliates#db:migrate", "vp run shop#db:migrate"],
        cache: false,
      },
      // Demo data in both apps' local databases (it resets them): the people in
      // apps/affiliates/demo.ts as shop accounts, and 90 days of the program (README, "Demo data").
      demo: {
        command: ["vp run shop#db:seed", "vp run affiliates#db:seed"],
        cache: false,
      },
      // The same demo data in both deployed apps, replacing everything in their databases
      // (scripts/demo-production.ts). For the demo deployment only; needs `void cloudflare login`.
      "demo:production": { command: "vpx scripts/demo-production.ts", cache: false },
      // Both apps: the shop on http://localhost:5173, the affiliate service on http://localhost:5174.
      dev: { command: "vp run -r --parallel dev", cache: false },
      // Chromium for the browser tests (once per machine).
      "install:browser": { command: "playwright install --with-deps chromium", cache: false },
      // The tests (e2e/dev/), against both apps started fresh for the run (e2e/apps.ts), so they
      // never touch your own local data or your `vp run dev`. Cached as Void's own repo caches its
      // tests: with none of the files the run reads changed, it replays the last result at once.
      // Left out: what running rewrites (the run's copies in .e2e, Void's generated .void, the
      // local databases in .wrangler, Node's compile cache). `vp test run --project dev` runs
      // them regardless; add a file to run just that one while working on it.
      "test:dev": {
        command: "vp test run --project dev",
        cache: {
          input: [
            { auto: true },
            "!.e2e/**",
            "!**/.wrangler/**",
            "!**/.void/**",
            "!**/node_modules/.cache/**",
          ],
          output: [],
        },
      },
      // Real Stripe test mode (e2e/stripe/): buyers buy tickets on Stripe's Checkout, and Stripe's
      // own webhooks reach the shop through the Stripe CLI. Needs the two accounts' test-mode keys
      // in the shell: STRIPE_TEST_SECRET_KEY (selling) and STRIPE_TEST_PAYOUTS_KEY (payouts).
      // Run it on demand.
      "test:stripe": { command: "vp test run --project stripe", cache: false },
      // The Durable Streams protocol's own conformance tests, and this repo's subscription tests,
      // against packages/streams in its Void app (packages/streams/app). About two minutes.
      "test:streams": { command: "vp test run --project streams", cache: false },
      // Screenshots of every page of both apps, desktop and phone, in .screens/, with demo data
      // made through the apps (scripts/screens.ts). Needs `vp run dev` running.
      screens: { command: "vpx scripts/screens.ts", cache: false },
    },
  },
  test: {
    projects: [
      {
        test: {
          name: "dev",
          include: ["e2e/dev/*.test.ts"],
          globalSetup: ["e2e/dev/setup.ts"],
          setupFiles: ["e2e/dev/each-file.ts"],
          pool: "forks",
          // Browser tests and work through queues take longer than Vitest's 5 seconds, and
          // starting both apps longer still (Void's own integration tests allow 120 seconds).
          testTimeout: 120_000,
          hookTimeout: 180_000,
          fileParallelism: false,
        },
      },
      {
        test: {
          // The protocol's own conformance tests against packages/streams, in its Void app.
          name: "streams",
          include: ["packages/streams/test/*.test.ts"],
          pool: "forks",
          // Their long-poll tests wait out the server's own 20 seconds.
          testTimeout: 60_000,
          hookTimeout: 120_000,
          fileParallelism: false,
        },
      },
      {
        test: {
          name: "stripe",
          include: ["e2e/stripe/*.test.ts"],
          globalSetup: ["e2e/stripe/setup.ts"],
          setupFiles: ["e2e/dev/each-file.ts"],
          pool: "forks",
          testTimeout: 120_000,
          hookTimeout: 180_000,
          fileParallelism: false,
        },
      },
    ],
  },
});

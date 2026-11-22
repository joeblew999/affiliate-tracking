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
      // The tests against the running apps (e2e/dev/): your `vp run dev` if it's up, else they
      // start one and stop it after. Cached as Void's own repo caches its tests: the files the run
      // reads are its inputs, so with none of them changed `vp run test:dev` replays the last
      // result at once. Left out: what the dev servers rewrite every run (the local databases in
      // .wrangler, Void's generated .void, Node's compile cache). `vp test run --project dev`
      // runs them regardless; add a file to run just that one while working on it.
      "test:dev": {
        command: "vp test run --project dev",
        cache: {
          input: [{ auto: true }, "!**/.wrangler/**", "!**/.void/**", "!**/node_modules/.cache/**"],
          output: [],
        },
      },
      // Real Stripe test mode (e2e/stripe/): needs STRIPE_TEST_SECRET_KEY in the shell, and
      // `vp run dev` stopped (it starts the apps itself, with the key). Run it on demand.
      "test:stripe": { command: "vp test run --project stripe", cache: false },
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

// The hub's Vite+ config (it's the Void app at the repo's root), and the repo's tasks and test
// projects. `vp dev` runs the hub; `vp run <task>` runs a task from anywhere.
import { defineConfig } from "vite-plus";
import { voidPlugin } from "void";

export default defineConfig({
  plugins: [voidPlugin()],
  environments: {
    void_worker: {
      // Found when the server starts, not on the first request that uses them (which reloads the
      // Worker mid-request, and its durable objects are unbound until it's back).
      optimizeDeps: { include: ["hono/bearer-auth", "zod"] },
    },
  },
  server: {
    // Always 5175 in development, where the example's workers find it.
    port: 5175,
    strictPort: true,
    // Workers reach the hub through their bindings, addressed as "hub" (client.ts). Vite's dev
    // server only answers host names it knows.
    allowedHosts: ["hub"],
  },
  // typeAware + typeCheck: `vp check` type-checks too (as in void-fbtee's root config).
  lint: { options: { typeAware: true, typeCheck: true } },
  // Void's record of each app's resources is Void's to write, in its own style, at every install.
  fmt: { ignorePatterns: ["**/void.lock.json"] },
  run: {
    tasks: {
      // The hub's local .env and database, and the example's. Once per clone, and after pulling
      // a new migration; safe to rerun.
      setup: {
        command: [
          "vpx examples/scripts/setup.ts",
          "vp run cloudflare-durable-streams#db:migrate",
          "vp run affiliates#db:migrate",
          "vp run shop#db:migrate",
        ],
        cache: false,
      },
      // The example's demo data in its two apps' local databases (it resets them): the people in
      // examples/affiliates/demo.ts as shop accounts, and 90 days of the program.
      demo: {
        command: ["vp run shop#db:seed", "vp run affiliates#db:seed"],
        cache: false,
      },
      // The same demo data in both deployed example apps, replacing everything in their databases
      // (examples/scripts/demo-production.ts). For the demo deployment only; needs `void cloudflare login`.
      "demo:production": { command: "vpx examples/scripts/demo-production.ts", cache: false },
      // The example with the hub: the hub on http://localhost:5175, the shop on 5173, the
      // affiliate service on 5174 (`vp dev` alone runs just the hub).
      "dev:example": { command: "vp run --filter './**' --parallel dev", cache: false },
      // Chromium for the example's browser tests, inside the repo (node_modules), not the
      // machine's cache (examples/package.json). Again after `vp install` brings a new Playwright.
      "install:browser": { command: "vp run examples#install:browser", cache: false },
      // The example's tests (examples/e2e/dev/), against its apps and the hub started fresh for the
      // run (examples/e2e/apps.ts), so they
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
      // Real Stripe test mode (examples/e2e/stripe/): buyers buy tickets on Stripe's Checkout, and Stripe's
      // own webhooks reach the shop through the Stripe CLI. Needs the two accounts' test-mode keys
      // in the shell: STRIPE_TEST_SECRET_KEY (selling) and STRIPE_TEST_PAYOUTS_KEY (payouts).
      // Run it on demand.
      "test:stripe": { command: "vp test run --project stripe", cache: false },
      // The Durable Streams protocol's own conformance tests (its authors' 338), and this repo's
      // subscription tests, against the hub itself under `vp dev` (test/). About a minute.
      "test:conformance": { command: "vp test run --project conformance", cache: false },
      // Screenshots of every page of the example's apps, desktop and phone, in .screens/, with demo
      // data made through the apps (examples/scripts/screens.ts). Needs `vp run dev:example`.
      screens: { command: "vpx examples/scripts/screens.ts", cache: false },
    },
  },
  test: {
    projects: [
      {
        test: {
          name: "dev",
          // The browser install:browser put in node_modules.
          env: { PLAYWRIGHT_BROWSERS_PATH: "0" },
          include: ["examples/e2e/dev/*.test.ts"],
          globalSetup: ["examples/e2e/dev/setup.ts"],
          setupFiles: ["examples/e2e/dev/each-file.ts"],
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
          // The protocol's own conformance tests, against the hub.
          name: "conformance",
          include: ["test/*.test.ts"],
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
          // The browser install:browser put in node_modules.
          env: { PLAYWRIGHT_BROWSERS_PATH: "0" },
          include: ["examples/e2e/stripe/*.test.ts"],
          globalSetup: ["examples/e2e/stripe/setup.ts"],
          setupFiles: ["examples/e2e/dev/each-file.ts"],
          pool: "forks",
          testTimeout: 120_000,
          hookTimeout: 180_000,
          fileParallelism: false,
        },
      },
    ],
  },
});

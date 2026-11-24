// Global setup for `vp run test:stripe`: real Stripe test mode, on the business's two accounts
// (examples/affiliates/env.ts), each a test-mode key in the shell:
// - STRIPE_TEST_SECRET_KEY: the selling account, with Managed Payments turned on in its Dashboard
//   (Stripe sells the tickets and handles the tax);
// - STRIPE_TEST_PAYOUTS_KEY: the payouts account, a Connect platform.
// Anything but test-mode keys (sk_test_… or rk_test_…) is refused. Makes a coupon in the selling
// account (the partners' buyer discount), and prepares the seeded apps as the dev tests do
// (../apps.ts), given the keys, the coupon and the payouts account's currency.
// The shop's webhook secret is the Stripe CLI's (`stripe listen --print-secret`), so the events
// `stripe listen` forwards (./listen.ts) are signed by Stripe for it. After: the coupon deleted
// and its promotion codes turned off. Runs only when asked for by name.
import { execFileSync } from "node:child_process";
import Stripe from "stripe";
import type { TestProject } from "vite-plus/test/node";
import { startSystem } from "../apps.ts";

declare module "vite-plus/test" {
  interface ProvidedContext {
    stripeSkip: string;
    /** The selling account's key. */
    stripeKey: string;
    payoutCurrency: string;
    /** The partners' buyer discount, in percent off. */
    couponPercent: number;
  }
}

/** The partners' buyer discount in the tests. */
const COUPON_PERCENT = 10;

/** The Stripe CLI (@stripe/cli), as `vp exec stripe` runs it. */
export function stripeCli(key: string, args: string[]): string {
  return execFileSync("vp", ["exec", "stripe", ...args, "--api-key", key, "--skip-update"], {
    encoding: "utf8",
  }).trim();
}

const testKey = (name: string) => {
  const key = process.env[name] ?? "";
  if (!/^(sk|rk)_test_/.test(key))
    throw new Error(`${name} must be a Stripe test-mode key (sk_test_… or rk_test_…)`);
  return key;
};

export default async function setup(project: TestProject) {
  if (!project.vitest.config.project.includes("stripe")) {
    project.provide("stripeSkip", "run it with `vp run test:stripe`");
    project.provide("system", null);
    return;
  }
  const salesKey = testKey("STRIPE_TEST_SECRET_KEY");
  const payoutsKey = testKey("STRIPE_TEST_PAYOUTS_KEY");
  const selling = new Stripe(salesKey);
  const payoutCurrency =
    (await new Stripe(payoutsKey).balance.retrieve()).available[0]?.currency ?? "usd";
  const coupon = await selling.coupons.create({
    percent_off: COUPON_PERCENT,
    duration: "once",
    name: "affiliates e2e",
  });
  // Both apps get the lot; each reads its own (the shop: STRIPE_SECRET_KEY, its selling account).
  // The shop's webhook secret is the Stripe CLI's, so what it forwards is signed for it.
  const { system, stop } = await startSystem(
    {
      STRIPE_SECRET_KEY: salesKey,
      STRIPE_SALES_KEY: salesKey,
      STRIPE_PAYOUTS_KEY: payoutsKey,
      AFFILIATES_COUPON_ID: coupon.id,
      AFFILIATES_PAYOUT_CURRENCY: payoutCurrency,
    },
    stripeCli(salesKey, ["listen", "--print-secret"]),
    "stripe",
  );
  project.provide("system", system);
  project.provide("stripeSkip", "");
  project.provide("stripeKey", salesKey);
  project.provide("payoutCurrency", payoutCurrency);
  project.provide("couponPercent", COUPON_PERCENT);
  return async () => {
    await stop();
    // The seeded partners' codes (SAM) come back every run: free them for the next one.
    for await (const promo of selling.promotionCodes.list({ coupon: coupon.id, active: true }))
      await selling.promotionCodes.update(promo.id, { active: false });
    await selling.coupons.del(coupon.id);
  };
}

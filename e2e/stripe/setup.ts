// Global setup for `vp run test:stripe`: real Stripe test mode. Needs STRIPE_TEST_SECRET_KEY in the
// shell (a test-mode key: sk_test_… or rk_test_…; anything else is refused). Makes, in Stripe:
// - Pro's price (a monthly price, in a currency other than the account's, so a payout converts it
//   at the rate Stripe settled each sale at);
// - a coupon, the partners' buyer discount;
// and prepares the seeded apps as the dev tests do (../apps.ts), with every file's apps given the
// key, the price, the coupon and the account's currency for payouts. The shop's webhook secret is
// the Stripe CLI's (`stripe listen --print-secret`), so the events `stripe listen` forwards
// (./listen.ts) are signed by Stripe for it. After: the coupon deleted and its promotion codes
// turned off, the price archived. Runs only when asked for by name.
import { execFileSync } from "node:child_process";
import Stripe from "stripe";
import type { TestProject } from "vite-plus/test/node";
import { prepareApps, removeApps } from "../apps.ts";

declare module "vite-plus/test" {
  interface ProvidedContext {
    stripeSkip: string;
    stripeKey: string;
    payoutCurrency: string;
    /** Pro's price, in its currency's minor units. */
    priceCents: number;
    priceCurrency: string;
  }
}

/** Pro's monthly price in the tests: 29.00 of the price's currency. */
const PRICE_CENTS = 2900;

/** The Stripe CLI (@stripe/cli), as `vp exec stripe` runs it. */
export function stripeCli(key: string, args: string[]): string {
  return execFileSync("vp", ["exec", "stripe", ...args, "--api-key", key], {
    encoding: "utf8",
  }).trim();
}

export default async function setup(project: TestProject) {
  if (!project.vitest.config.project.includes("stripe")) {
    project.provide("stripeSkip", "run it with `vp run test:stripe`");
    return;
  }
  const key = process.env.STRIPE_TEST_SECRET_KEY ?? "";
  if (!/^(sk|rk)_test_/.test(key))
    throw new Error(
      "STRIPE_TEST_SECRET_KEY must be a Stripe test-mode key (sk_test_… or rk_test_…)",
    );
  const stripe = new Stripe(key);
  const balance = await stripe.balance.retrieve();
  const payoutCurrency = balance.available[0]?.currency ?? "usd";
  const priceCurrency = payoutCurrency === "eur" ? "gbp" : "eur";
  const price = await stripe.prices.create({
    currency: priceCurrency,
    unit_amount: PRICE_CENTS,
    recurring: { interval: "month" },
    product_data: { name: "Pro (affiliates e2e)" },
  });
  const coupon = await stripe.coupons.create({
    percent_off: 10,
    duration: "once",
    name: "affiliates e2e",
  });
  const template = await prepareApps();
  template.webhookSecret = stripeCli(key, ["listen", "--print-secret"]);
  project.provide("template", template);
  project.provide("appEnv", {
    STRIPE_SECRET_KEY: key,
    STRIPE_PRO_PRICE_ID: price.id,
    AFFILIATES_COUPON_ID: coupon.id,
    AFFILIATES_PAYOUT_CURRENCY: payoutCurrency,
  });
  project.provide("stripeSkip", "");
  project.provide("stripeKey", key);
  project.provide("payoutCurrency", payoutCurrency);
  project.provide("priceCents", PRICE_CENTS);
  project.provide("priceCurrency", priceCurrency);
  return async () => {
    removeApps(template);
    // The seeded partners' codes (SAM) come back every run: free them for the next one.
    for await (const promo of stripe.promotionCodes.list({ coupon: coupon.id, active: true }))
      await stripe.promotionCodes.update(promo.id, { active: false });
    await stripe.coupons.del(coupon.id);
    await stripe.prices.update(price.id, { active: false });
  };
}

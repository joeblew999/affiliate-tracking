// Global setup for `vp run test:stripe`: real Stripe test mode. Needs STRIPE_TEST_SECRET_KEY in the
// shell (a test-mode key: sk_test_… or rk_test_…; anything else is refused). Prepares the seeded
// apps as the dev tests do (../apps.ts), and has every file start them with that key, a new test
// coupon (the partners' buyer discount), and the payout currency set to the Stripe account's own,
// so the "other currency" sale really is in another currency. Deletes the coupon and turns off
// its promotion codes after. Runs only
// when asked for by name.
import Stripe from "stripe";
import type { TestProject } from "vite-plus/test/node";
import { prepareApps, removeApps } from "../apps.ts";

declare module "vite-plus/test" {
  interface ProvidedContext {
    stripeSkip: string;
    stripeKey: string;
    payoutCurrency: string;
    saleCurrency: string;
  }
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
  const coupon = await stripe.coupons.create({
    percent_off: 10,
    duration: "once",
    name: "affiliates e2e",
  });
  const template = await prepareApps();
  project.provide("template", template);
  project.provide("appEnv", {
    STRIPE_SECRET_KEY: key,
    AFFILIATES_COUPON_ID: coupon.id,
    AFFILIATES_PAYOUT_CURRENCY: payoutCurrency,
  });
  project.provide("stripeSkip", "");
  project.provide("stripeKey", key);
  project.provide("payoutCurrency", payoutCurrency);
  project.provide("saleCurrency", payoutCurrency === "eur" ? "gbp" : "eur");
  return async () => {
    removeApps(template);
    // The seeded partners' codes (SAM) come back every run: free them for the next one.
    for await (const promo of stripe.promotionCodes.list({ coupon: coupon.id, active: true }))
      await stripe.promotionCodes.update(promo.id, { active: false });
    await stripe.coupons.del(coupon.id);
  };
}

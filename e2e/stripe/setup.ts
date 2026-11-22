// Global setup for the Stripe end-to-end tests (`vp run test:stripe`): real Stripe test mode. Needs
// STRIPE_TEST_SECRET_KEY in the shell (a test-mode key: sk_test_… or rk_test_…; anything else is
// refused). Starts both apps itself with that key, a fresh test coupon (the partners' buyer
// discount), and the payout currency set to the Stripe account's own settlement currency, so the
// "other currency" sale really is in another currency. Stops them and deletes the coupon after.
// Runs only when asked for by name: a plain `vp test run` skips it.
import Stripe from "stripe";
import type { TestProject } from "vite-plus/test/node";
import { AFFILIATES, answers, appEnv, SHOP, startDev, stop, untilReady } from "../servers";

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
  if ((await answers(SHOP)) || (await answers(AFFILIATES))) {
    throw new Error(
      "Stop `vp run dev` first: this suite starts the apps itself, with the Stripe key",
    );
  }
  const stripe = new Stripe(key);
  const balance = await stripe.balance.retrieve();
  const payoutCurrency = balance.available[0]?.currency ?? "usd";
  const saleCurrency = payoutCurrency === "eur" ? "gbp" : "eur";
  const coupon = await stripe.coupons.create({
    percent_off: 10,
    duration: "once",
    name: "affiliates e2e",
  });

  const dev = await startDev({
    STRIPE_SECRET_KEY: key,
    AFFILIATES_COUPON_ID: coupon.id,
    AFFILIATES_PAYOUT_CURRENCY: payoutCurrency,
  });
  await untilReady();
  project.provide("stripeSkip", "");
  project.provide("stripeKey", key);
  project.provide("payoutCurrency", payoutCurrency);
  project.provide("saleCurrency", saleCurrency);
  project.provide("hostToken", appEnv("affiliates", "AFFILIATES_HOST_TOKEN"));
  // Stripe events go to the shop's Better Auth Stripe webhook, signed with its secret.
  project.provide("webhookSecret", appEnv("shop", "STRIPE_WEBHOOK_SECRET"));
  return async () => {
    stop(dev);
    await stripe.coupons.del(coupon.id);
  };
}

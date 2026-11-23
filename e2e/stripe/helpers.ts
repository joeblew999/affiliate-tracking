// The Stripe tests' people and what they do in Stripe: subscribing on the shop and paying on
// Stripe's own Checkout page, and Stripe's test clocks for time passing. Everything else is the
// dev tests' helpers (../dev/helpers.ts).
import type { Page } from "playwright";
import Stripe from "stripe";
import { inject } from "vite-plus/test";
import { SHOP, signUp, type Person } from "../dev/helpers.ts";

/** Stripe, with the run's test-mode key. */
export const stripe = () => new Stripe(inject("stripeKey"));

const DAY = 24 * 60 * 60;

/** The Stripe customer the shop's Better Auth made for this person at sign-up. */
export async function customerOf(person: Person): Promise<Stripe.Customer> {
  const [customer] = (await stripe().customers.list({ email: person.email, limit: 1 })).data;
  if (!customer) throw new Error(`no Stripe customer for ${person.email}`);
  return customer;
}

/**
 * A buyer: signed up on the shop through `via` (a referral link), their Stripe customer put on a
 * test clock of their own (docs.stripe.com/billing/testing/test-clocks), so their subscription's
 * months can pass in Stripe. Delete the clock after (`clocks`), which deletes the customer too.
 */
export async function buyer(name: string, via: string, clocks: string[]) {
  const person = await signUp(name, { via });
  const clock = await stripe().testHelpers.testClocks.create({
    frozen_time: Math.floor(Date.now() / 1000),
    customer: (await customerOf(person)).id,
    name: `affiliates e2e: ${person.email}`,
  });
  clocks.push(clock.id);
  return { ...person, clock: clock.id };
}

/** Let `days` pass on a buyer's test clock; done once Stripe has caught up. */
export async function advance(clock: string, days: number): Promise<void> {
  const now = (await stripe().testHelpers.testClocks.retrieve(clock)).frozen_time;
  await stripe().testHelpers.testClocks.advance(clock, { frozen_time: now + days * DAY });
  for (;;) {
    const { status } = await stripe().testHelpers.testClocks.retrieve(clock);
    if (status === "ready") return;
    if (status === "internal_failure") throw new Error(`test clock ${clock} failed`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** Subscribe to Pro on the shop, and pay on Stripe's Checkout with Stripe's test card. */
export async function subscribe(person: Person): Promise<void> {
  const { page } = person;
  await page.getByRole("button", { name: "Subscribe to Pro" }).click();
  await page.waitForURL(/^https:\/\/checkout\.stripe\.com\//);
  await pay(page);
  // Back through the plugin's success page, which takes in the subscription, to the shop.
  await page.waitForURL(`${SHOP}/**`, { timeout: 60_000 });
  await page.getByText(/^Subscribed: renews /).waitFor();
}

/** Stripe's Checkout page, paid with the card Stripe's test mode always accepts. */
async function pay(page: Page): Promise<void> {
  const card = page.getByTestId("card-accordion-item-button");
  await page.locator("#cardNumber").or(card).first().waitFor();
  if (await card.isVisible()) await card.click();
  await page.locator("#cardNumber").fill("4242424242424242");
  await page.locator("#cardExpiry").fill("12 / 34");
  await page.locator("#cardCvc").fill("123");
  await page.locator("#billingName").fill("Test Buyer");
  const postal = page.locator("#billingPostalCode");
  if (await postal.isVisible()) await postal.fill("10001");
  await page.getByTestId("hosted-payment-submit-button").click();
}

/** The buyer's subscription, as Stripe has it now. */
export async function subscriptionOf(person: Person): Promise<Stripe.Subscription> {
  const customer = await customerOf(person);
  const [subscription] = (await stripe().subscriptions.list({ customer: customer.id, limit: 1 }))
    .data;
  if (!subscription) throw new Error(`no subscription for ${person.email}`);
  return subscription;
}

/** The payment of an invoice, with its charge's settlement (the balance transaction). */
export async function paymentOf(invoice: string | Stripe.Invoice | null) {
  const id = typeof invoice === "string" ? invoice : (invoice?.id ?? "");
  const [payment] = (await stripe().invoicePayments.list({ invoice: id, limit: 1 })).data;
  const intent = payment?.payment.payment_intent;
  return stripe().paymentIntents.retrieve(
    typeof intent === "string" ? intent : (intent?.id ?? ""),
    {
      expand: ["latest_charge.balance_transaction"],
    },
  );
}

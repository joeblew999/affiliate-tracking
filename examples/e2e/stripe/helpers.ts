// The Stripe tests' people and what they do in Stripe: buying a ticket on the shop and paying on
// Stripe's own Checkout page. Everything else is the dev tests' helpers (../dev/helpers.ts).
import type { Page } from "playwright";
import Stripe from "stripe";
import { inject } from "vite-plus/test";
import type { demoEvents } from "../../affiliates/demo.ts";
import { open, SHOP, type Person } from "../dev/helpers.ts";

/** The selling account, with the run's test-mode key. */
export const stripe = () => new Stripe(inject("stripeKey"));

/** Buy a ticket to an event on the shop, and pay on Stripe's Checkout with Stripe's test card. */
export async function buyTicket(person: Person, event: keyof typeof demoEvents): Promise<void> {
  const { page } = person;
  await open(page, `${SHOP}/events/${event}`);
  await page.getByRole("button", { name: /^Buy ticket/ }).click();
  await page.waitForURL(/^https:\/\/checkout\.stripe\.com\//);
  await pay(page);
  await page.waitForURL(`${SHOP}/events/${event}`, { timeout: 60_000 });
  await page.getByText("You have a ticket.").waitFor();
}

/**
 * Stripe's Checkout page, paid with the card Stripe's test mode always accepts, from a New York
 * address (Managed Payments works out the tax from it).
 */
async function pay(page: Page): Promise<void> {
  const card = page.getByTestId("card-accordion-item-button");
  await page.locator("#cardNumber").or(card).first().waitFor();
  if (await card.isVisible()) await card.click();
  await page.locator("#cardNumber").fill("4242424242424242");
  await page.locator("#cardExpiry").fill("12 / 34");
  await page.locator("#cardCvc").fill("123");
  await page.locator("#billingName").fill("Test Buyer");
  const country = page.locator("#billingCountry");
  if (await country.isVisible()) await country.selectOption("US");
  const postal = page.locator("#billingPostalCode");
  if (await postal.isVisible()) await postal.fill("10001");
  await page.getByTestId("hosted-payment-submit-button").click();
}

/** The Stripe customer the shop's Better Auth made for this person at sign-up. */
async function customerOf(person: Person): Promise<Stripe.Customer> {
  const [customer] = (await stripe().customers.list({ email: person.email, limit: 1 })).data;
  if (!customer) throw new Error(`no Stripe customer for ${person.email}`);
  return customer;
}

/** The payment of this person's latest ticket, with its charge's settlement. */
export async function ticketPayment(person: Person) {
  const customer = await customerOf(person);
  const [session] = (
    await stripe().checkout.sessions.list({ customer: customer.id, status: "complete", limit: 1 })
  ).data;
  const intent = session?.payment_intent;
  return stripe().paymentIntents.retrieve(
    typeof intent === "string" ? intent : (intent?.id ?? ""),
    {
      expand: ["latest_charge.balance_transaction"],
    },
  );
}

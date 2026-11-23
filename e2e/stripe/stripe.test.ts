// The shop and the affiliate program on real Stripe (test mode), with nothing made up. People sign
// up through a partner's link and subscribe to Pro on Stripe's own Checkout page, paying with
// Stripe's test card. Stripe's own webhooks reach the shop through the Stripe CLI (./listen.ts).
// Renewals and refunds are real charges and refunds in Stripe. Expected amounts come from the
// seeded partners (apps/affiliates/demo.ts) and Pro's price (setup.ts).
import type { ChildProcess } from "node:child_process";
import type { Page } from "playwright";
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, inject, test } from "vite-plus/test";
import {
  decideSale,
  eventually,
  partnerButton,
  partnerMe,
  payoutsOf,
  runPayouts,
  saleOf,
  salesOf,
  seededPartner,
  seededPartnerId,
  SHOP,
  signUp,
  type Person,
} from "../dev/helpers.ts";
import { listen } from "./listen.ts";

const skip = inject("stripeSkip");

describe.skipIf(skip)(`Stripe end-to-end${skip ? ` (${skip})` : ""}`, () => {
  const stripe = () => new Stripe(inject("stripeKey"));
  const price = () => inject("priceCents");

  let listener: ChildProcess | undefined;
  beforeAll(async () => {
    listener = await listen(inject("stripeKey"), SHOP);
  });
  afterAll(() => {
    listener?.kill();
  });

  /** Subscribe to Pro on the shop, and pay on Stripe's Checkout with Stripe's test card. */
  async function subscribe(buyer: Person): Promise<void> {
    const { page } = buyer;
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

  /** The buyer's subscription in Stripe, made by the shop's checkout. */
  async function subscriptionOf(buyer: Person): Promise<Stripe.Subscription> {
    const [customer] = (await stripe().customers.list({ email: buyer.email, limit: 1 })).data;
    if (!customer) throw new Error(`no Stripe customer for ${buyer.email}`);
    const [subscription] = (await stripe().subscriptions.list({ customer: customer.id, limit: 1 }))
      .data;
    if (!subscription) throw new Error(`no subscription for ${buyer.email}`);
    return subscription;
  }

  /** The payment of an invoice, with the charge's settlement (its balance transaction). */
  async function paymentOf(invoice: string | Stripe.Invoice | null) {
    const id = typeof invoice === "string" ? invoice : (invoice?.id ?? "");
    const [payment] = (await stripe().invoicePayments.list({ invoice: id, limit: 1 })).data;
    const intent = payment?.payment.payment_intent;
    const intentId = typeof intent === "string" ? intent : (intent?.id ?? "");
    return stripe().paymentIntents.retrieve(intentId, {
      expand: ["latest_charge.balance_transaction"],
    });
  }

  // Tom: 20%, every sale of his reviewed, nothing ready to pay in the seed.
  let buyer: Person;
  const commission = () => Math.round(price() * 0.2);

  test(
    "a buyer through a partner's link subscribes on Stripe's Checkout; the sale is the partner's",
    {
      timeout: 180_000,
    },
    async () => {
      const tom = await seededPartner("tom");
      buyer = await signUp("Pro Buyer", { via: `/r/${tom.code}` });
      await subscribe(buyer);
      await eventually(async () => {
        expect(await saleOf(tom.name, buyer.email)).toMatchObject({
          paidCents: price(),
          commissionCents: commission(),
          status: "pending",
        });
      });
    },
  );

  test("a payout pays the sale at the rate Stripe settled it at", async () => {
    const tom = await seededPartner("tom");
    await decideSale(buyer.email, "Approve");
    await runPayouts();
    const intent = await paymentOf((await subscriptionOf(buyer)).latest_invoice);
    const charge = intent.latest_charge;
    const txn = charge && typeof charge === "object" ? charge.balance_transaction : null;
    if (!charge || typeof charge !== "object" || !txn || typeof txn !== "object")
      throw new Error("no settled charge");
    expect(txn.currency).toBe(inject("payoutCurrency"));
    const expected = Math.round((commission() * txn.amount) / charge.amount);
    await eventually(async () => {
      expect(await payoutsOf(tom.name)).toMatchObject([
        { amountCents: expected, status: "manual" },
      ]);
    });
  });

  test(
    "Stripe charging the next month is a renewal, the partner's again; refunding it refunds it",
    {
      timeout: 180_000,
    },
    async () => {
      const tom = await seededPartner("tom");
      // A new billing period from now: Stripe invoices it and charges the card, as at renewal.
      const renewed = await stripe().subscriptions.update((await subscriptionOf(buyer)).id, {
        billing_cycle_anchor: { type: "now" },
        proration_behavior: "none",
      });
      const renewal = async () => (await salesOf(tom.name)).find((s) => s.notes === "renewal");
      await eventually(async () => {
        expect(await renewal()).toMatchObject({ commissionCents: commission(), status: "pending" });
      });

      await stripe().refunds.create({
        payment_intent: (await paymentOf(renewed.latest_invoice)).id,
      });
      await eventually(async () => {
        expect((await renewal())?.status).toBe("refunded");
      });
    },
  );

  test(
    "approving a partner makes their promotion code; a buyer through them gets its discount, and the sale is theirs",
    {
      timeout: 180_000,
    },
    async () => {
      const sam = await seededPartner("sam");
      await partnerButton(sam.name, "Approve");
      const code = (await partnerMe(sam)).promoCode ?? "";
      expect(code).toBe(sam.code.toUpperCase());
      const [promotion] = (await stripe().promotionCodes.list({ code, active: true, limit: 1 }))
        .data;
      expect(promotion?.metadata).toMatchObject({ partner_id: seededPartnerId("sam") });

      const samBuyer = await signUp("Discount Buyer", { via: `/r/${sam.code}` });
      await subscribe(samBuyer);
      await eventually(async () => {
        expect(await saleOf(sam.name, samBuyer.email)).toMatchObject({
          paidCents: Math.round(price() * 0.9), // the coupon's 10% off
          status: "pending",
        });
      });
    },
  );
});

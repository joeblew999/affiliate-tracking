// The shop and the affiliate program on real Stripe (test mode), with nothing made up. Buyers sign
// up through a partner's link and buy a ticket on Stripe's own Checkout page (Managed Payments:
// Stripe adds the tax), paying with Stripe's test card. Stripe's own webhooks reach the shop
// through the Stripe CLI (./listen.ts), and refunds are real ones. Expected amounts come from the
// seeded partners and events (apps/affiliates/demo.ts) and the coupon (setup.ts).
import type { ChildProcess } from "node:child_process";
import { afterAll, beforeAll, describe, expect, inject, test } from "vite-plus/test";
import { demoEvents } from "../../apps/affiliates/demo.ts";
import {
  activity,
  admin,
  AFFILIATES,
  decideSale,
  demoPartner,
  partnerButton,
  open,
  partnerMe,
  payoutsOf,
  runPayouts,
  saleOf,
  seededPartner,
  seededPartnerId,
  SHOP,
  signUp,
  type Person,
} from "../dev/helpers.ts";
import { buyTicket, stripe, ticketPayment } from "./helpers.ts";
import { listen } from "./listen.ts";

const skip = inject("stripeSkip");

describe.skipIf(skip)(`Stripe end-to-end${skip ? ` (${skip})` : ""}`, () => {
  const ticket = demoEvents.workshop.cents;
  /** A partner's commission on a workshop ticket at their seeded rate: on the price, not the tax. */
  const commission = (code: string) => Math.round((ticket * demoPartner(code).commissionPct) / 100);

  let listener: ChildProcess | undefined;
  beforeAll(async () => {
    listener = await listen(inject("stripeKey"), SHOP);
  });
  afterAll(() => {
    listener?.kill();
  });

  /**
   * Buy a workshop ticket on Stripe's Checkout, done once Stripe's webhook for it has been handled
   * all the way, as the admin's control plane shows it. Its payment.
   */
  async function buyAndRecord(buyer: Person): Promise<string> {
    const pane = await adminPane();
    const before = await pane.seen();
    await buyTicket(buyer, "workshop");
    await pane.finished("Stripe webhook", {
      step: "Stripe checkout.session.completed",
      after: before,
    });
    return (await ticketPayment(buyer)).id;
  }

  /** The admin's Activity pane, on their admin page. */
  async function adminPane() {
    const { page } = await admin();
    await open(page, `${AFFILIATES}/admin`);
    return activity(page);
  }

  // Tom: every sale of his reviewed, and nothing ready to pay in the seed.
  const tom = demoPartner("tom");
  let tomsBuyer: Person;

  test(
    "a buyer through a partner's link buys a ticket on Stripe's Checkout; the sale is the partner's",
    { timeout: 180_000 },
    async () => {
      tomsBuyer = await signUp("Ticket Buyer", { via: `/r/${tom.code}` });
      await buyAndRecord(tomsBuyer);
      const sale = await saleOf(tom.name, tomsBuyer.email);
      expect(sale).toMatchObject({ commissionCents: commission(tom.code), status: "pending" });
      expect(sale?.paidCents).toBeGreaterThanOrEqual(ticket); // and any tax Stripe added
    },
  );

  test("approved and paid out: the partner's commission, in the payouts account's currency", async () => {
    await decideSale(tomsBuyer.email, "Approve");
    await runPayouts();
    const charge = (await ticketPayment(tomsBuyer)).latest_charge;
    const txn = charge && typeof charge === "object" ? charge.balance_transaction : null;
    if (!charge || typeof charge !== "object" || !txn || typeof txn !== "object")
      throw new Error("no settled charge");
    // Tom has no Stripe account of his own: a manual payout, for the admin to pay.
    const expected =
      txn.currency === charge.currency
        ? commission(tom.code)
        : Math.round((commission(tom.code) * txn.amount) / charge.amount);
    expect(await payoutsOf(tom.name)).toMatchObject([{ amountCents: expected, status: "manual" }]);
  });

  test("a refunded ticket refunds the sale", async () => {
    const priya = await seededPartner("priya");
    const buyer = await signUp("Refund Buyer", { via: `/r/${priya.code}` });
    const paymentIntent = await buyAndRecord(buyer);
    expect(await saleOf(priya.name, buyer.email)).toBeTruthy();
    const pane = await adminPane();
    const before = await pane.seen();
    await stripe().refunds.create({ payment_intent: paymentIntent });
    await pane.finished("Stripe webhook", { step: "Stripe charge.refunded", after: before });
    expect((await saleOf(priya.name, buyer.email))?.status).toBe("refunded");
  });

  test(
    "approving a partner makes their promotion code; a buyer through them gets its discount, and the sale is theirs",
    {
      timeout: 180_000,
    },
    async () => {
      const sam = demoPartner("sam");
      await partnerButton(sam.name, "Approve");
      const code = (await partnerMe(await seededPartner(sam.code))).promoCode ?? "";
      expect(code).toBe(sam.code.toUpperCase());
      const [promotion] = (await stripe().promotionCodes.list({ code, active: true, limit: 1 }))
        .data;
      expect(promotion?.metadata).toMatchObject({ partner_id: seededPartnerId(sam.code) });

      const samsBuyer = await signUp("Discount Buyer", { via: `/r/${sam.code}` });
      await buyAndRecord(samsBuyer);
      const discounted = Math.round((ticket * (100 - inject("couponPercent"))) / 100);
      // His commission is on the discounted price, not counting tax.
      expect(await saleOf(sam.name, samsBuyer.email)).toMatchObject({
        commissionCents: Math.round((discounted * sam.commissionPct) / 100),
        status: "pending",
      });
    },
  );
});

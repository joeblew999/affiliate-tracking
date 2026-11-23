// The shop and the affiliate program on real Stripe (test mode), with nothing made up. Buyers sign
// up through a partner's link and subscribe to Pro on Stripe's own Checkout page, paying with
// Stripe's test card. Stripe's own webhooks reach the shop through the Stripe CLI (./listen.ts). A
// month passes on Stripe's test clock for a renewal, and refunds are real ones. Expected amounts
// come from the seeded partners (apps/affiliates/demo.ts) and Pro's price and coupon (setup.ts).
import type { ChildProcess } from "node:child_process";
import { afterAll, beforeAll, describe, expect, inject, test } from "vite-plus/test";
import {
  decideSale,
  demoPartner,
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
} from "../dev/helpers.ts";
import { advance, buyer, paymentOf, stripe, subscribe, subscriptionOf } from "./helpers.ts";
import { listen } from "./listen.ts";

const skip = inject("stripeSkip");

describe.skipIf(skip)(`Stripe end-to-end${skip ? ` (${skip})` : ""}`, () => {
  const price = () => inject("priceCents");
  /** A partner's commission on one Pro month, at their seeded rate. */
  const commission = (code: string) =>
    Math.round((price() * demoPartner(code).commissionPct) / 100);

  let listener: ChildProcess | undefined;
  const clocks: string[] = [];
  beforeAll(async () => {
    listener = await listen(inject("stripeKey"), SHOP);
  });
  afterAll(async () => {
    listener?.kill();
    // Each buyer's clock, and with it their customer and subscription.
    for (const clock of clocks) await stripe().testHelpers.testClocks.del(clock);
  });

  // Tom: every sale of his reviewed, and nothing ready to pay in the seed.
  const tom = demoPartner("tom");
  let tomsBuyer: Awaited<ReturnType<typeof buyer>>;

  test(
    "a buyer through a partner's link subscribes on Stripe's Checkout; the sale is the partner's",
    {
      timeout: 180_000,
    },
    async () => {
      tomsBuyer = await buyer("Pro Buyer", `/r/${tom.code}`, clocks);
      await subscribe(tomsBuyer);
      await eventually(async () => {
        expect(await saleOf(tom.name, tomsBuyer.email)).toMatchObject({
          paidCents: price(),
          commissionCents: commission(tom.code),
          status: "pending",
        });
      });
    },
  );

  test("a payout pays the sale at the rate Stripe settled it at", async () => {
    await decideSale(tomsBuyer.email, "Approve");
    await runPayouts();
    const intent = await paymentOf((await subscriptionOf(tomsBuyer)).latest_invoice);
    const charge = intent.latest_charge;
    const txn = charge && typeof charge === "object" ? charge.balance_transaction : null;
    if (!charge || typeof charge !== "object" || !txn || typeof txn !== "object")
      throw new Error("no settled charge");
    expect(txn.currency).toBe(inject("payoutCurrency"));
    const expected = Math.round((commission(tom.code) * txn.amount) / charge.amount);
    await eventually(async () => {
      expect(await payoutsOf(tom.name)).toMatchObject([
        { amountCents: expected, status: "manual" },
      ]);
    });
  });

  test(
    "a month on, Stripe's renewal is the partner's again; refunding it refunds it",
    {
      timeout: 180_000,
    },
    async () => {
      await advance(tomsBuyer.clock, 32);
      const renewal = async () => (await salesOf(tom.name)).find((s) => s.notes === "renewal");
      await eventually(async () => {
        expect(await renewal()).toMatchObject({
          commissionCents: commission(tom.code),
          status: "pending",
        });
      });

      const renewed = await subscriptionOf(tomsBuyer);
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
      const sam = demoPartner("sam");
      await partnerButton(sam.name, "Approve");
      const code = (await partnerMe(await seededPartner(sam.code))).promoCode ?? "";
      expect(code).toBe(sam.code.toUpperCase());
      const [promotion] = (await stripe().promotionCodes.list({ code, active: true, limit: 1 }))
        .data;
      expect(promotion?.metadata).toMatchObject({ partner_id: seededPartnerId(sam.code) });

      const samsBuyer = await buyer("Discount Buyer", `/r/${sam.code}`, clocks);
      await subscribe(samsBuyer);
      await eventually(async () => {
        expect(await saleOf(sam.name, samsBuyer.email)).toMatchObject({
          paidCents: Math.round((price() * (100 - inject("couponPercent"))) / 100),
          status: "pending",
        });
      });
    },
  );
});

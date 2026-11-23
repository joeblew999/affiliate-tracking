// Refunds on the seeded sales (apps/affiliates/demo.ts): one before it's paid comes off the sale;
// one after it's paid is clawed back from the next payout.
import { expect, test } from "vite-plus/test";
import { demoPayouts, demoPeople, demoSales } from "../../apps/affiliates/demo.ts";
import {
  eventually,
  payoutsOf,
  runPayouts,
  saleOf,
  salesOf,
  seededSale,
  stripeEvent,
} from "./helpers.ts";

const name = (code: string) => demoPeople.find((p) => p.partner?.code === code)?.name ?? "";
const ready = (code: string) =>
  demoSales
    .filter((s) => s.partner === code && s.status === "approved")
    .reduce((sum, s) => sum + s.commissionCents, 0);
const seededPayouts = (code: string) => demoPayouts.filter((p) => p.partner === code).length;

/** Stripe refunding part of a seeded sale's $290 payment: `refunded` is Stripe's running total. */
const refund = (label: string, refunded: number) =>
  stripeEvent("charge.refunded", {
    id: `ch_${label}`,
    object: "charge",
    amount: 29000,
    amount_refunded: refunded,
    payment_intent: seededSale(label).paymentIntent,
  });

test("a refund before payment comes off the sale; after payment it's clawed back from the next payout", async () => {
  // Leo's yearly sale, approved, not paid yet: 30% refunded takes 30% off its $58.
  await refund("leo_5", 8700);
  await refund("leo_5", 8700); // sent again: no change
  expect(await saleOf(name("leo"), seededSale("leo_5").customer)).toMatchObject({
    status: "approved",
    commissionCents: 4060,
    notes: "$87.00 refunded",
  });

  // Maya's yearly sale, already paid its $72.50: 20% refunded is $14.50 clawed back.
  await refund("maya_1", 5800);
  expect(await saleOf(name("maya"), seededSale("maya_1").customer)).toMatchObject({
    status: "paid",
    commissionCents: 7250,
    notes: "$58.00 refunded",
  });
  const clawbacks = (await salesOf(name("maya"))).filter((s) => s.notes.startsWith("clawback"));
  expect(clawbacks.map((s) => `${s.status} ${s.commissionCents}`).sort()).toEqual([
    "approved -1450",
    "approved -725", // the seed's own
  ]);

  // The next payout: Leo's ready less his refund; Maya owes more than she's due, so nothing.
  await runPayouts();
  await eventually(async () => {
    const leo = await payoutsOf(name("leo"));
    expect(leo).toHaveLength(seededPayouts("leo") + 1);
    expect(leo[0]?.amountCents).toBe(ready("leo") - 1740);
  });
  expect(ready("maya") - 1450).toBeLessThan(0);
  expect(await payoutsOf(name("maya"))).toHaveLength(seededPayouts("maya"));
});

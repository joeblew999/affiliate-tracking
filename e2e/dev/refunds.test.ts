// Refunds on the seeded sales (apps/affiliates/demo.ts): one before it's paid comes off the sale;
// one after it's paid is clawed back from the next payout.
import { expect, test } from "vite-plus/test";
import {
  demoPartner,
  eventually,
  payoutsOf,
  runPayouts,
  saleOf,
  salesOf,
  seededPayoutCount,
  seededReadyCents,
  seededSale,
  stripeEvent,
} from "./helpers.ts";

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
  expect(await saleOf(demoPartner("leo").name, seededSale("leo_5").customer)).toMatchObject({
    status: "approved",
    commissionCents: 4060,
    notes: "$87.00 refunded",
  });

  // Maya's yearly sale, already paid its $72.50: 20% refunded is $14.50 clawed back.
  await refund("maya_1", 5800);
  expect(await saleOf(demoPartner("maya").name, seededSale("maya_1").customer)).toMatchObject({
    status: "paid",
    commissionCents: 7250,
    notes: "$58.00 refunded",
  });
  const clawbacks = (await salesOf(demoPartner("maya").name)).filter((s) =>
    s.notes.startsWith("clawback"),
  );
  expect(clawbacks.map((s) => `${s.status} ${s.commissionCents}`).sort()).toEqual([
    "approved -1450",
    "approved -725", // the seed's own
  ]);

  // The next payout: Leo's ready less his refund; Maya owes more than she's due, so nothing.
  await runPayouts();
  await eventually(async () => {
    const leo = await payoutsOf(demoPartner("leo").name);
    expect(leo).toHaveLength(seededPayoutCount("leo") + 1);
    expect(leo[0]?.amountCents).toBe(seededReadyCents("leo") - 1740);
  });
  expect(seededReadyCents("maya") - 1450).toBeLessThan(0);
  expect(await payoutsOf(demoPartner("maya").name)).toHaveLength(seededPayoutCount("maya"));
});

// Refunds on the seeded sales (examples/affiliates/demo.ts): one before it's paid comes off the sale;
// one after it's paid is clawed back from the next payout. No browser: each sale as it now stands
// is read from the admin's state stream (bus.ts).
import { expect, test } from "vite-plus/test";
import { fixtureId } from "../../affiliates/demo.ts";
import { adminBus, stripeEvent, written } from "./bus.ts";
import { seededPartnerId, seededReadyCents, seededSale } from "./helpers.ts";

const saleId = (label: string) => fixtureId(`sale:${label}`);

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
  // Leo's masterclass ticket, approved, not paid yet: 30% refunded takes 30% off its $58.
  await refund("leo_5", 8700);
  await refund("leo_5", 8700); // sent again: no change
  const sale = async (label: string) =>
    (await written()).sales().find((s) => s.id === saleId(label));
  expect(await sale("leo_5")).toMatchObject({
    status: "approved",
    commissionCents: 4060,
    refundedCents: 8700,
  });

  // Maya's masterclass ticket, already paid its $72.50: 20% refunded is $14.50 clawed back.
  await refund("maya_1", 5800);
  expect(await sale("maya_1")).toMatchObject({
    status: "paid",
    commissionCents: 7250,
    refundedCents: 5800,
  });
  const clawbacks = (await written())
    .sales()
    .filter((s) => s.kind === "clawback" && s.refundOf === saleId("maya_1"));
  expect(clawbacks.map((s) => `${s.status} ${s.commissionCents}`)).toEqual(["approved -1450"]);

  // The next payout: Leo's ready less his refund; Maya owes more than she's due, so nothing.
  await (await adminBus()).act("/admin", "runPayouts");
  const payouts = (await written()).payouts();
  expect(payouts.filter((p) => p.partnerId === seededPartnerId("leo"))).toEqual([
    expect.objectContaining({ amountCents: seededReadyCents("leo") - 1740 }),
  ]);
  expect(seededReadyCents("maya") - 1450).toBeLessThan(0);
  expect(payouts.filter((p) => p.partnerId === seededPartnerId("maya"))).toEqual([]);
});

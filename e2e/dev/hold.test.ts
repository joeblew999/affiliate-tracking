// The hold period, on the seeded sales (apps/affiliates/demo.ts): the daily job, run as of 25 days
// after DEMO_NOW, approves exactly the sales then HOLD_DAYS old, and none that are flagged, under
// an open dispute, rejected, too new, or of a partner who's suspended or has every sale reviewed.
import { expect, test } from "vite-plus/test";
import { decideSale, demoPartner, runCron, saleOf, seededSale, stripeEvent } from "./helpers.ts";

const DAILY = "17 3 * * *";
const statusOf = async (label: string) => {
  const sale = seededSale(label);
  return (await saleOf(demoPartner(sale.partner).name, sale.customer))?.status;
};

test("25 days on, the daily job approves the sales past their hold, and only those", async () => {
  // An open dispute on part of Maya's sale 20 days ago, and an admin rejecting Priya's 25 days ago.
  const disputed = seededSale("maya_7");
  await stripeEvent("charge.dispute.created", {
    id: "dp_maya_7",
    object: "dispute",
    amount: 1000, // part of it: the sale stays, on hold while the dispute is open
    charge: "ch_maya_7",
    payment_intent: disputed.paymentIntent,
    status: "needs_response",
  });
  await decideSale(demoPartner("priya").name, seededSale("priya_3").customer, "Reject");

  await runCron(DAILY, { daysLater: 25 });
  expect({
    leo_6: await statusOf("leo_6"), // 12 + 25 days old
    ana_2: await statusOf("ana_2"), // 15 + 25
    maya_7: await statusOf("maya_7"), // under an open dispute
    priya_3: await statusOf("priya_3"), // rejected
    maya_8: await statusOf("maya_8"), // flagged: Maya's own email
    maya_9: await statusOf("maya_9"), // 3 + 25 days: still too new
    tom_1: await statusOf("tom_1"), // Tom has every sale reviewed
    ken_2: await statusOf("ken_2"), // Ken is suspended
  }).toEqual({
    leo_6: "approved",
    ana_2: "approved",
    maya_7: "pending",
    priya_3: "rejected",
    maya_8: "pending",
    maya_9: "pending",
    tom_1: "pending",
    ken_2: "pending",
  });
});

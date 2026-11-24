// The hold period, on the seeded sales (apps/affiliates/demo.ts): the daily job, run as of 25 days
// after DEMO_NOW, approves exactly the sales then HOLD_DAYS old, and none that are flagged, under
// an open dispute, rejected, too new, or of a partner who's suspended or has every sale reviewed.
// No browser: what changed is read from the admin's state stream (bus.ts), and a seeded sale
// nothing wrote is as the seed left it.
import { expect, test } from "vite-plus/test";
import { fixtureId } from "../../apps/affiliates/demo.ts";
import { adminBus, runCron, stripeEvent, written } from "./bus.ts";
import { seededSale } from "./helpers.ts";

const DAILY = "17 3 * * *";
const saleId = (label: string) => fixtureId(`sale:${label}`);

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
  await (
    await adminBus()
  ).act("/admin", "changeSale", { id: saleId("priya_3"), status: "rejected" });

  await runCron(DAILY, { daysLater: 25 });
  const sales = (await written()).sales();
  const statusOf = (label: string) =>
    sales.find((sale) => sale.id === saleId(label))?.status ?? seededSale(label).status;
  expect({
    leo_6: statusOf("leo_6"), // 12 + 25 days old
    ana_2: statusOf("ana_2"), // 15 + 25
    maya_7: statusOf("maya_7"), // under an open dispute
    priya_3: statusOf("priya_3"), // rejected
    maya_8: statusOf("maya_8"), // flagged: Maya's own email
    maya_9: statusOf("maya_9"), // 3 + 25 days: still too new
    tom_1: statusOf("tom_1"), // Tom has every sale reviewed
    ken_2: statusOf("ken_2"), // Ken is suspended
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

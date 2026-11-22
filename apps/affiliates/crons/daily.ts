// Once a day: sales past the hold period approved (src/hold.ts), and any payout left pending
// (a crash, a Stripe error past the queue's retries) queued again, so it always finishes.
import { defineScheduled } from "void";
import { queues } from "void/queues";
import { releaseHeldSales } from "../src/hold";
import { partnersWithPendingPayouts } from "../src/payouts";

export const cron = "17 3 * * *";

export default defineScheduled(async () => {
  const released = await releaseHeldSales();
  const pending = await partnersWithPendingPayouts();
  for (const partnerId of pending) await queues.payouts.send({ partnerId });
  console.log(
    `daily: ${released} sales approved after the hold period, ${pending.length} pending payouts queued again`,
  );
});

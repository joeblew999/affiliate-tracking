// Once a day: sales past the hold period approved (src/hold.ts), as of the time the run is for (its
// scheduledTime, from Cloudflare; Void's dev trigger takes one too), and any payout left pending
// (a crash, a Stripe error past the queue's retries) queued again, so it always finishes.
import { defineScheduled } from "void";
import { queues } from "void/queues";
import { releaseHeldSales } from "../src/hold.ts";
import { partnersWithPendingPayouts } from "../src/payouts.ts";

export const cron = "17 3 * * *";

export default defineScheduled(async (controller) => {
  const released = await releaseHeldSales(controller.scheduledTime);
  const pending = await partnersWithPendingPayouts();
  for (const partnerId of pending) await queues.payouts.send({ partnerId });
  console.log(
    `daily: ${released} sales approved after the hold period, ${pending.length} pending payouts queued again`,
  );
});

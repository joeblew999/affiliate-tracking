// Once a day: sales past the hold period approved (src/hold.ts), as of the time the run is for (its
// scheduledTime, from Cloudflare; Void's dev trigger takes one too), and any payout left pending
// (a crash, a Stripe error past the queue's retries) queued again, so it always finishes; and any
// event whose venue is paid put on sale (src/events.ts). Each run is an action in the control
// plane (src/activity.ts), for admins.
import { venuePaid } from "../src/events.ts";
import { releaseHeldSales } from "../src/hold.ts";
import { partnersWithPendingPayouts, queuePayouts } from "../src/payouts.ts";
import { defineScheduled } from "../src/activity.ts";

export const cron = "17 3 * * *";

export default defineScheduled("Daily job", async (controller) => {
  await releaseHeldSales(controller.scheduledTime);
  const pending = await partnersWithPendingPayouts();
  if (pending.length) await queuePayouts(pending);
  // An event whose venue was paid but didn't go on sale (a crash between the two): on sale now.
  await venuePaid();
});

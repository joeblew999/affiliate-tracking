// One message per partner to pay (src/payouts.ts queuePayouts). Its step in the control plane
// (src/activity.ts) shows it running, done, or failed with the error, which Void then tries again;
// src/payouts.ts picks up where the last attempt was.
import type { payouts } from "@schema";
import { defineQueue } from "../src/activity.ts";
import { payoutWritten } from "../src/outcomes.ts";
import { payPartner } from "../src/payouts.ts";

/** One partner to pay. */
type Message = Pick<typeof payouts.$inferSelect, "partnerId">;

// Handed over as soon as it's sent. Unset, a queue waits up to 5 seconds for more messages to
// make a batch (Void's default, guide/queues.md), and every step through it is that much later.
export const maxBatchTimeout = 0;

export default defineQueue<Message>(async (batch) => {
  for (const msg of batch.messages) {
    const outcome = await payPartner(msg.body.partnerId);
    // The payout and its sales as they now stand, for whoever watches the run (src/outcomes.ts).
    await payoutWritten(msg.body.partnerId, "payoutId" in outcome ? outcome.payoutId : undefined);
    // Refunded before paying: the payout is released, and this step fails with why.
    if (outcome.status === "failed") throw new Error(outcome.reason);
    msg.ack();
  }
});

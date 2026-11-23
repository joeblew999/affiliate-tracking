// One message per partner to pay (src/payouts.ts queuePayouts). Its step in the control plane
// (src/activity.ts) shows it running, done, or failed with the error, which Void then tries again;
// src/payouts.ts picks up where the last attempt was.
import type { payouts } from "@schema";
import { defineQueue } from "../src/activity.ts";
import { payPartner } from "../src/payouts.ts";

/** One partner to pay. */
type Message = Pick<typeof payouts.$inferSelect, "partnerId">;

export default defineQueue<Message>(async (batch) => {
  for (const msg of batch.messages) {
    const outcome = await payPartner(msg.body.partnerId);
    // Refunded before paying: the payout is released, and this step fails with why.
    if (outcome.status === "failed") throw new Error(outcome.reason);
    msg.ack();
  }
});

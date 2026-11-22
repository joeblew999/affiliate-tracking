// One message per partner to pay (POST /api/payouts: routes/api/payouts/index.ts; crons/daily.ts). A failure is
// logged and retried; src/payouts.ts picks up where the last attempt was.
import type { payouts } from "@schema";
import { defineQueue } from "void";
import { payPartner } from "../src/payouts";

/** One partner to pay. */
type Message = Pick<typeof payouts.$inferSelect, "partnerId">;

export default defineQueue<Message>(async (batch) => {
  for (const msg of batch.messages) {
    try {
      const outcome = await payPartner(msg.body.partnerId);
      console.log(`payout for partner ${msg.body.partnerId}: ${outcome.status}`);
      msg.ack();
    } catch (err) {
      console.error(
        `payout for partner ${msg.body.partnerId} failed (attempt ${msg.attempts}):`,
        err,
      );
      msg.retry();
    }
  }
});

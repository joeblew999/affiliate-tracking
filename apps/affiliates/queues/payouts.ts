// One message per partner to pay (routes/api/admin/payouts/run.ts, crons/daily.ts). A failure is
// logged and retried; src/payouts.ts picks up where the last attempt was.
import { defineQueue } from "void";
import { payPartner } from "../src/payouts";

interface PayPartner {
  partnerId: string;
}

export default defineQueue<PayPartner>(async (batch) => {
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

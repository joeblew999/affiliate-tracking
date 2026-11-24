// Things that happened, on their way to their streams (src/published.ts). Each is a step of its
// action in the control plane (src/activity.ts): done, or failed with the error, which Void then
// tries again.
import { defineQueue } from "../src/activity.ts";
import { write, type Published } from "../src/published.ts";

// Handed over as soon as it's sent. Unset, a queue waits up to 5 seconds for more messages to
// make a batch (Void's default, guide/queues.md), and every step through it is that much later.
export const maxBatchTimeout = 0;

export default defineQueue<Published>(
  async (batch) => {
    for (const msg of batch.messages) {
      await write(msg.body);
      msg.ack();
    }
  },
  // A Stripe event's step says which: "Stripe charge.refunded".
  {
    step: (event) =>
      event.type === "stripe-event" ? `Stripe ${event.data.type}` : `publish: ${event.type}`,
  },
);

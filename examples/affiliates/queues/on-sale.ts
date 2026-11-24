// One message per event that's gone on sale (src/events.ts venuePaid): published for the host
// (src/hub.ts), which follows it and tells its users. Its step in the control plane
// (src/activity.ts) shows it done, or failed with the error (the hub down), which Void then tries
// again.
import { eventOnSale } from "../src/events.ts";
import { defineQueue } from "../src/activity.ts";
import { publishOnSale } from "../src/hub.ts";

/** One event gone on sale. */
type Message = { eventId: string };

// Handed over as soon as it's sent. Unset, a queue waits up to 5 seconds for more messages to
// make a batch (Void's default, guide/queues.md), and every step through it is that much later.
export const maxBatchTimeout = 0;

export default defineQueue<Message>(async (batch) => {
  for (const msg of batch.messages) {
    const event = await eventOnSale(msg.body.eventId);
    // Already over, or never on sale: nothing to tell.
    if (event) await publishOnSale({ event });
    msg.ack();
  }
});

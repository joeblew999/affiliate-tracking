// Stripe's events, from its webhook (Better Auth's Stripe plugin checks the signature: auth.ts),
// passed on to the affiliate service, which counts sales, refunds and disputes. Queued, so Stripe
// gets its answer at once; each is a step in the control plane (src/activity.ts), and a failure is
// tried again. The service records each Stripe event once, so a repeat changes nothing.
import type Stripe from "stripe";
import { affiliatesService } from "../src/affiliates.ts";
import { defineQueue } from "../src/activity.ts";

// Handed over as soon as it's sent. Unset, a queue waits up to 5 seconds for more messages to
// make a batch (Void's default, guide/queues.md), and every step through it is that much later.
export const maxBatchTimeout = 0;

export default defineQueue<Stripe.Event>(
  async (batch) => {
    for (const msg of batch.messages) {
      await affiliatesService().stripeEvent(msg.body);
      msg.ack();
    }
  },
  { step: (event) => `Stripe ${event.type}` },
);

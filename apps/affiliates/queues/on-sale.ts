// One message per event that's gone on sale (src/events.ts venuePaid): the host is told, through
// its binding, so it can tell its users. Its step in the control plane (src/activity.ts) shows it
// done, or failed with the error (the host down), which Void then tries again.
import { env } from "void/env";
import { env as bindings } from "cloudflare:workers";
import { OnSaleInput, OnSaleOutput } from "../src/host-contract.ts";
import { eventOnSale } from "../src/events.ts";
import { activityHeaders, defineQueue } from "../src/activity.ts";

declare global {
  namespace Cloudflare {
    interface Env extends VoidGeneratedEnvBindings {}
  }
}

/** One event gone on sale. */
type Message = { eventId: string };

// Handed over as soon as it's sent. Unset, a queue waits up to 5 seconds for more messages to
// make a batch (Void's default, guide/queues.md), and every step through it is that much later.
export const maxBatchTimeout = 0;

export default defineQueue<Message>(async (batch) => {
  for (const msg of batch.messages) {
    const event = await eventOnSale(msg.body.eventId);
    // Already over, or never on sale: nothing to tell.
    if (event) {
      const res = await bindings.HOST.fetch(
        new Request(new URL("/api/affiliates/on-sale", env.HOST_SITE_URL), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${env.AFFILIATES_HOST_TOKEN}`,
            ...activityHeaders(),
          },
          body: JSON.stringify(OnSaleInput.parse({ event })),
        }),
      );
      if (!res.ok) throw new Error(`host on-sale: ${res.status} ${await res.text()}`);
      OnSaleOutput.parse(await res.json());
    }
    msg.ack();
  }
});

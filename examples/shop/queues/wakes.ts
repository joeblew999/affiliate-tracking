// A wake from the hub (routes/api/hub/wake.ts): what's new on the streams the shop follows is
// read, dealt with and acknowledged (src/followed.ts). If anything fails the message is tried again
// (Void's queue), and the events not yet acknowledged are read again.
import type { Wake } from "cloudflare-durable-streams/bus";
import { defineQueue } from "../src/activity.ts";
import { followed } from "../src/followed.ts";

// Handed over as soon as it's sent. Unset, a queue waits up to 5 seconds for more messages to
// make a batch (Void's default, guide/queues.md), and every step through it is that much later.
export const maxBatchTimeout = 0;

export default defineQueue<Wake>(
  async (batch) => {
    for (const msg of batch.messages) {
      await followed.deal(msg.body);
      msg.ack();
    }
  },
  { step: () => "Wake: read and acknowledge" },
);

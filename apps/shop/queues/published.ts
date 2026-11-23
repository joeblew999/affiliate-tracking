// Things that happened, on their way to their streams (src/published.ts). Each is a step of its
// action in the control plane (src/activity.ts): done, or failed with the error, which Void then
// tries again.
import { defineQueue } from "../src/activity.ts";
import { write, type Published } from "../src/published.ts";

export default defineQueue<Published>(
  async (batch) => {
    for (const msg of batch.messages) {
      await write(msg.body);
      msg.ack();
    }
  },
  { step: (event) => `publish: ${event.type}` },
);

// The hub wakes the shop here when a stream it follows has something new (src/followed.ts). It only
// checks the wake is the hub's (its signature, against the hub's published keys) and queues it:
// the reading, the work and the acknowledging are the queue's (queues/wakes.ts), so the hub has
// its answer at once and a wake is never lost to a slow or failed piece of work.
import { defineHandler } from "void";
import { queues } from "../../../src/activity.ts";
import { followed } from "../../../src/followed.ts";

export const POST = defineHandler(async (c) => {
  const wake = await followed.wakeFrom(c.req.raw);
  if (!wake) return c.json({ error: "Not signed by the hub" }, 401);
  await queues.wakes.send(wake);
  // Taken, not finished: the consumer acknowledges once it has dealt with what's new.
  return c.json({});
});

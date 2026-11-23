// The shop's streams wake this service here when one it follows has something new (src/hub.ts).
// It only checks the wake is the shop's (its signature, against the shop's published keys) and
// queues it: the reading, the work and the acknowledging are the queue's (queues/wakes.ts), so
// the shop has its answer at once and a wake is never lost to a slow or failed piece of work.
import { defineHandler } from "void";
import { wakeIsSigned, type Wake } from "streams/subscriber";
import { queues } from "../../../src/activity.ts";
import { shopKeys } from "../../../src/hub.ts";

export const POST = defineHandler(async (c) => {
  const body = await c.req.text();
  const signature = c.req.header("webhook-signature") ?? null;
  const signed =
    (await wakeIsSigned(body, signature, await shopKeys())) ||
    (await wakeIsSigned(body, signature, await shopKeys(true)));
  if (!signed) return c.json({ error: "Not signed by the shop" }, 401);
  await queues.wakes.send(JSON.parse(body) as Wake);
  // Taken, not finished: the consumer acknowledges once it has dealt with what's new.
  return c.json({});
});

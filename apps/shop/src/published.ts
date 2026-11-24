// Things that happened in the shop, for other workers to react to. Each kind is a stream in the
// hub (src/hub.ts). A worker that cares follows the stream with a subscription of its own: it's
// woken when there's something new, reads on from where it had got to, and acknowledges. The shop
// doesn't call it, wait for it or know who it is.
//
// publish() from anywhere: the event goes onto the shop's queue (queues/published.ts) first, so
// what's publishing never waits on the hub or fails because of it, and a failed write is tried
// again.
import { SIGNUPS_STREAM, type Signup } from "affiliates/client";
import { currentTrace, waiting } from "activity/server";
import { queues } from "./activity.ts";
import { hub } from "./hub.ts";

/** What can be published: the stream it goes to, what it's called, and what it says. */
export type Published = { stream: typeof SIGNUPS_STREAM; type: "signed-up"; data: Signup };

export const publish = (event: Published) => queues.published.send(event);

/** Write an event to its stream now (the queue's consumer). */
export async function write({ stream, type, data }: Published) {
  const trace = currentTrace();
  const id = crypto.randomUUID();
  const { subscribers } = await hub.publish(stream, { id, type, data, activity: trace });
  // In the control plane, each subscriber's part is a step of the same action: waiting now, and
  // run by the subscriber when it gets to the event (it names the step the same way).
  for (const subscription of subscribers)
    await waiting(`${id}:${subscription}`, `${type}: ${subscription}`);
}

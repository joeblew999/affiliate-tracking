// Things that happened in the shop, for other workers to react to. Each kind is a stream
// (src/streams.ts). A worker that cares follows the stream with a subscription: it's woken when
// there's something new, reads on from where it had got to, and acknowledges. The shop doesn't
// call it, wait for it or know what it does with the event.
//
// publish() from anywhere: the event goes onto the shop's queue (queues/published.ts) first, so
// what's publishing never waits on the streams or fails because of them, and a failed write is
// tried again.
import { env as vars } from "void/env";
import { SIGNUPS_STREAM, SIGNUPS_SUBSCRIPTION, type Signup } from "affiliates/client";
import { currentTrace, waiting } from "activity/server";
import { queues } from "./activity.ts";
import { add, subscribe } from "./streams.ts";

/** What can be published: the stream it goes to, what it's called, and what it says. */
export type Published = { stream: typeof SIGNUPS_STREAM; type: "signed-up"; data: Signup };

export const publish = (event: Published) => queues.published.send(event);

/**
 * Who follows what. The affiliate service follows new users; its wakes go to its
 * /api/host/wake (apps/affiliates), through its binding (durable-objects/stream-subscriptions.ts).
 */
const subscribers = () => ({
  [SIGNUPS_SUBSCRIPTION]: {
    type: "webhook",
    streams: [SIGNUPS_STREAM],
    webhook: { url: new URL("/api/host/wake", vars.AFFILIATES_SITE_URL).href },
    // How long the service has to deal with a wake before it's sent again.
    lease_ttl_ms: 60_000,
    description: "The affiliate service, told of each new user",
  },
});

/** The subscriptions followed above: for the daily check (crons/daily.ts). */
export const subscriptionIds = () => Object.keys(subscribers());

// Once in each run of the Worker, before anything is written: a subscription made after an event
// would start after it.
let subscribed: Promise<unknown> | undefined;
const ensureSubscribed = () =>
  (subscribed ??= Promise.all(
    Object.entries(subscribers()).map(([id, input]) => subscribe(id, input)),
  ).catch((error: unknown) => {
    subscribed = undefined;
    throw error;
  }));

/** Write an event to its stream now (the queue's consumer). */
export async function write({ stream, type, data }: Published) {
  await ensureSubscribed();
  const trace = currentTrace();
  const id = crypto.randomUUID();
  const told = await add(stream, { id, type, data, activity: trace });
  // In the control plane, each subscriber's part is a step of the same action: waiting now, and
  // run by the subscriber when it gets to the event (it names the step the same way).
  for (const subscription of told)
    await waiting(`${id}:${subscription}`, `${type}: ${subscription}`);
}

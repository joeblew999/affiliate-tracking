// Things that happened, told to whoever follows them, over the hub (apps/hub): how one worker of
// the program lets another know of something without calling it. Each kind of thing is a stream.
// The worker it happened in publishes it there. A worker that cares follows the stream with a
// subscription of its own: the hub wakes it, it reads on from where it had got to, deals with each
// event, and acknowledges. Neither waits for the other or knows who it is.
//
// In the control plane it stays one action: the publisher leaves a step waiting for each
// subscriber, and the subscriber runs its part as that step.
import type { Hub } from "hub/client";
import { STREAMS } from "hub/client";
import {
  acknowledge,
  readOn,
  serverKeys,
  wakeIsSigned,
  type PublicJwk,
  type Wake,
} from "streams/subscriber";
import { z } from "zod";
import { currentTrace, runStep, waiting } from "./server.ts";

export type { Wake };

/** An event on a followed stream: what happened, and the action it's part of. */
const Published = z.object({
  /** The event's own id. */
  id: z.string(),
  type: z.string(),
  data: z.unknown(),
  activity: z.object({ actionId: z.string(), viewers: z.array(z.string()) }).nullable(),
});

/**
 * Publish something that happened, now: written to its stream, with a step left waiting for each
 * subscriber. From work that's tried again if it fails (a queue's consumer).
 */
export async function publishNow(hub: Hub, stream: string, type: string, data: unknown) {
  const id = crypto.randomUUID();
  const event: z.input<typeof Published> = { id, type, data, activity: currentTrace() };
  const { subscribers } = await hub.publish(stream, event);
  for (const subscription of subscribers)
    await waiting(`${id}:${subscription}`, `${type}: ${subscription}`);
}

/** One thing a worker follows: the stream, and what it does with each event on it. */
export type Followed = {
  stream: string;
  /** The worker's part, as the control plane shows it. */
  title: string;
  description: string;
  /** An event's data, checked and dealt with. */
  handle: (data: unknown) => Promise<void>;
};

/**
 * One thing a worker follows. `data`: what the events on the stream say, checked before `work`
 * gets it. Dealing with an event twice has to be harmless: one not yet acknowledged is read again.
 */
export const follows = <Data>(one: {
  stream: string;
  data: z.ZodType<Data>;
  title: string;
  description: string;
  work: (data: Data) => Promise<void>;
}): Followed => ({
  stream: one.stream,
  title: one.title,
  description: one.description,
  handle: (data) => one.work(one.data.parse(data)),
});

/**
 * A worker's side of following streams. `wakeUrl`: this worker's own address for wakes.
 * `subscriptions`: each subscription's id, and what it follows.
 */
export function follower(options: {
  hub: Hub;
  wakeUrl: string;
  subscriptions: Record<string, Followed>;
}) {
  const { hub, wakeUrl, subscriptions } = options;
  let said: Promise<unknown> | undefined;
  let keys: Promise<PublicJwk[]> | undefined;

  /** The keys the hub signs its wakes with. `fresh`: ask again (a wake signed with one not seen). */
  const hubKeys = (fresh = false) => {
    if (fresh) keys = undefined;
    return (keys ??= serverKeys(hub.streams, STREAMS).catch((error: unknown) => {
      keys = undefined;
      throw error;
    }));
  };

  return {
    /**
     * What this worker follows, said to the hub once in each run of the Worker (the subscriptions
     * themselves stay in the hub; saying it again changes nothing). If the hub can't be reached,
     * that's logged and the next call tries again: a request never fails for it.
     */
    following(): Promise<unknown> {
      return (said ??= Promise.all(
        Object.entries(subscriptions).map(([id, one]) =>
          hub.subscribe(id, {
            streams: [one.stream],
            wake: wakeUrl,
            description: one.description,
          }),
        ),
      ).catch((error: unknown) => {
        said = undefined;
        console.error("hub: couldn't subscribe", error);
      }));
    },

    /** A wake as the hub sent it, if it's the hub's (its signature, against the hub's keys). */
    async wakeFrom(request: Request): Promise<Wake | null> {
      const body = await request.text();
      const signature = request.headers.get("webhook-signature");
      const signed =
        (await wakeIsSigned(body, signature, await hubKeys())) ||
        (await wakeIsSigned(body, signature, await hubKeys(true)));
      return signed ? (JSON.parse(body) as Wake) : null;
    },

    /**
     * Deal with a wake: for each stream it says has something new, read on from what's
     * acknowledged, do the work for each event, then acknowledge up to there. If anything fails
     * it throws (the queue tries the wake again, and the events not yet acknowledged are read
     * again).
     */
    async deal(wake: Wake): Promise<void> {
      const one = subscriptions[wake.subscription_id];
      if (!one) return;
      const acks: { stream: string; offset: string }[] = [];
      for (const stream of wake.streams) {
        if (!stream.has_pending) continue;
        const { events, offset } = await readOn<unknown>(
          hub.streams,
          `${STREAMS}/${stream.path}`,
          stream.acked_offset,
        );
        for (const raw of events) {
          const event = Published.parse(raw);
          const work = () => one.handle(event.data);
          // A step of the action it's part of, which the publisher left waiting under this name.
          if (event.activity)
            await runStep(event.activity, `${event.id}:${wake.subscription_id}`, one.title, work);
          else await work();
        }
        acks.push({ stream: stream.path, offset });
      }
      const outcome = await acknowledge(hub.streams, wake.callback_url, wake, acks);
      // Read further than the subscription has yet heard the stream goes (a write it's still being
      // told of): acknowledge what the wake itself showed; the rest comes with the next wake.
      if (outcome === "ahead")
        await acknowledge(
          hub.streams,
          wake.callback_url,
          wake,
          wake.streams
            .filter((stream) => stream.has_pending)
            .map((stream) => ({ stream: stream.path, offset: stream.tail_offset })),
        );
    },
  };
}

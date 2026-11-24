// Things that happened, told to whoever follows them, over the hub: how one worker of the program
// lets another know of something without calling it. Each kind of thing is a stream. The worker it
// happened in publishes it there (a protocol write). A worker that cares follows the stream with a
// subscription of its own: the hub wakes it, it reads on from where it had got to, deals with each
// event, and acknowledges. Neither waits for the other or knows who it is.
//
// What travels with each event besides what happened is the app's (a Carry): the control plane
// sends the action it's part of, and runs the follower's work as a step of it
// (the example's control plane, examples/activity: its `carried`).
import {
  acknowledge,
  serverKeys,
  wakeIsSigned,
  type PublicJwk,
  type Wake,
} from "./src/server/subscriber.ts";
import { z } from "zod";
import { STREAMS, type Hub } from "./client.ts";

export type { Wake };

/** An event on a followed stream: what happened, and what came with it (Carry). */
const Published = z.object({
  /** The event's own id. */
  id: z.string(),
  type: z.string(),
  data: z.unknown(),
  carried: z.unknown().nullable(),
});

/**
 * What travels with an event, and how a follower's work for it runs. Each follower's part has an
 * id (the event's and the subscription's) and a name, the same on both sides.
 */
export type Carry = {
  /** What to send with an event published now; null for nothing. */
  current(): unknown;
  /** An event was published and this subscriber woken: its part, not yet done. */
  waiting(id: string, name: string): Promise<unknown>;
  /** A subscriber's part, run with what came with the event. */
  run(carried: unknown, id: string, name: string, work: () => Promise<void>): Promise<void>;
};

/** Nothing travels with an event. */
const nothing: Carry = {
  current: () => null,
  waiting: async () => null,
  run: (_carried, _id, _name, work) => work(),
};

const partOf = (eventId: string, subscription: string) => `${eventId}:${subscription}`;

/**
 * Publishing, for one worker: an event written to its stream now, and each subscriber woken left
 * waiting (Carry). From work that's tried again if it fails (a queue's consumer).
 */
export function publisher(hub: Hub, carry: Carry = nothing) {
  return async (stream: string, type: string, data: unknown): Promise<void> => {
    const id = crypto.randomUUID();
    const event: z.input<typeof Published> = { id, type, data, carried: carry.current() };
    const { subscriptions } = await hub.append(stream, [event]);
    for (const subscription of subscriptions)
      await carry.waiting(partOf(id, subscription), `${type}: ${subscription}`);
  };
}

/** One thing a worker follows: the stream, and what it does with each event on it. */
export type Followed = {
  stream: string;
  /** The worker's part, as people are shown it. */
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
  carry?: Carry;
}) {
  const { hub, wakeUrl, subscriptions, carry = nothing } = options;
  let said: Promise<unknown> | undefined;
  let keys: Promise<PublicJwk[]> | undefined;

  /** The keys the hub signs its wakes with. `fresh`: ask again (a wake signed with one not seen). */
  const hubKeys = (fresh = false) => {
    if (fresh) keys = undefined;
    return (keys ??= serverKeys(hub.fetch, STREAMS).catch((error: unknown) => {
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
        let { events, offset } = await hub.read(stream.path, stream.acked_offset);
        // The nearest replica not yet at the write that woke this: the rest from the primary.
        if (offset < stream.tail_offset) {
          const rest = await hub.read(stream.path, offset, { primary: true });
          events = [...events, ...rest.events];
          offset = rest.offset;
        }
        for (const raw of events) {
          const event = Published.parse(raw);
          const work = () => one.handle(event.data);
          if (event.carried === null) await work();
          else
            await carry.run(event.carried, partOf(event.id, wake.subscription_id), one.title, work);
        }
        acks.push({ stream: stream.path, offset });
      }
      const outcome = await acknowledge(hub.fetch, wake.callback_url, wake, acks);
      // Read further than the subscription has yet heard the stream goes (a write it's still being
      // told of): acknowledge what the wake itself showed; the rest comes with the next wake.
      if (outcome === "ahead")
        await acknowledge(
          hub.fetch,
          wake.callback_url,
          wake,
          wake.streams
            .filter((stream) => stream.has_pending)
            .map((stream) => ({ stream: stream.path, offset: stream.tail_offset })),
        );
    },
  };
}

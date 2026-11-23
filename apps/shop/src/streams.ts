// The shop's streams (Durable Streams, with subscriptions: packages/streams), at /streams:
// - one per viewer (a person's user id, or "admins"), holding the events of the work that concerns
//   them, for the Activity pane (packages/activity);
// - one per kind of thing that happened ("events/signups"), which other workers follow with a
//   subscription (src/published.ts).
// The shop's code writes them here. Anything else reaches them through routes/streams/[...path].ts.
import { createStreamsHandler } from "@durable-streams/server-cloudflare";
import { env } from "cloudflare:workers";
import type { ActivityEvent } from "activity";
import { createStreams } from "streams";
import { Directory } from "../durable-objects/stream-directory.ts";
import { Signing } from "../durable-objects/stream-signing.ts";
import { Subscriptions } from "../durable-objects/stream-subscriptions.ts";
import { RecentActions } from "../durable-objects/recent-actions.ts";
import { Streams } from "../durable-objects/streams.ts";

/** Where the streams are mounted. */
export const ROOT = "/streams";

/**
 * The address the shop's own code gives the streams. Not a real one: a subscriber is told where
 * to acknowledge as a path under it, and reaches the shop its own way (its binding).
 */
export const ORIGIN = "https://shop";

// Who may call is decided by the route, with the shop's sign-in and token. Saying so here also
// stops anything caching what's read.
const streams = createStreams({
  root: ROOT,
  streams: createStreamsHandler({ cors: false, auth: () => undefined }),
  subscriptions: Subscriptions,
  directory: Directory,
  signing: Signing,
});

const bindings = env as never;

/** A request to the streams, already allowed. */
export const serve = (request: Request) => streams.handle(request, bindings);

/** Add an event to a stream others may follow. Answers with the subscriptions told of it. */
export const add = async (stream: string, event: unknown) =>
  (await streams.append(bindings, ORIGIN, stream, event)).subscribers;

/** Make sure a subscription is there. */
export const subscribe = (id: string, input: Record<string, unknown>) =>
  streams.subscribe(bindings, ORIGIN, id, input);

/** Wake a subscriber if a stream it follows has gone past what it has acknowledged. */
export const recheck = (id: string) => streams.recheck(bindings, ORIGIN, id);

const JSON_TYPE = { "content-type": "application/json" };

/** A stream nobody has read or written for this long is removed (30 days). */
const UNUSED_SECONDS = 30 * 24 * 60 * 60;

/** A viewer's stream: its path, which is also where it's read, and the object that holds it. */
export function streamOf(viewer: string) {
  const path = `${ROOT}/${viewer}`;
  const url = `${ORIGIN}${path}`;
  const object = Streams.get(path);
  return {
    /** Make the stream, if it isn't there yet. */
    create: () =>
      object.fetch(url, {
        method: "PUT",
        headers: { ...JSON_TYPE, "stream-ttl": String(UNUSED_SECONDS) },
      }),
    add: (event: ActivityEvent) =>
      object.fetch(url, { method: "POST", headers: JSON_TYPE, body: JSON.stringify(event) }),
    /** Where it ends now; "-1" (its start) if it isn't there. */
    async end(): Promise<string> {
      const head = await object.fetch(url, { method: "HEAD" });
      return (head.ok && head.headers.get("stream-next-offset")) || "-1";
    },
    /** Its events after `offset`, up to where it ends now, and that end. */
    async since(offset: string): Promise<{ events: unknown[]; offset: string }> {
      const events: unknown[] = [];
      let at = offset;
      for (;;) {
        const read = await object.fetch(`${url}?offset=${encodeURIComponent(at)}`);
        if (!read.ok) return { events, offset: at };
        events.push(...((await read.json()) as unknown[]));
        at = read.headers.get("stream-next-offset") ?? at;
        if (read.headers.get("stream-up-to-date") === "true") return { events, offset: at };
      }
    },
  };
}

/**
 * One event of the control plane, added to the end of a viewer's stream; the stream is made by its
 * first event. Straight to the stream's own object: nothing subscribes to a viewer's stream, and
 * every step of every action is written here, so it doesn't stop to look for subscribers. Where
 * each action starts is noted (durable-objects/recent-actions.ts), for recent() below.
 */
export async function append(viewer: string, event: ActivityEvent) {
  const stream = streamOf(viewer);
  if (event.type === "started") await RecentActions.get(viewer).started(await stream.end());
  let added = await stream.add(event);
  if (added.status === 404) {
    await stream.create();
    added = await stream.add(event);
  }
  if (!added.ok) throw new Error(`Stream of ${viewer}: ${added.status} ${await added.text()}`);
}

/**
 * A viewer's latest actions' events, and the offset they go up to: what a page starts with
 * (packages/activity's pane), reading on from that offset itself.
 */
export async function recent(viewer: string) {
  return streamOf(viewer).since(await RecentActions.get(viewer).from());
}

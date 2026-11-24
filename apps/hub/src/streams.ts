// The hub's streams (Durable Streams, with subscriptions: packages/streams), at /streams. Two
// kinds, by how they're used:
// - read: a stream someone watches. append() adds to it, straight to the stream's own object;
// - followed: a stream of things that happened, which workers follow with a subscription.
//   publish() adds to it and tells them.
// The hub's own routes call these (routes/api/). Everything else is the streams' own protocol,
// served by serve() (routes/streams/[...path].ts).
import { createStreamsHandler } from "@durable-streams/server-cloudflare";
import { env } from "cloudflare:workers";
import { createStreams } from "streams";
import { Marks } from "../durable-objects/marks.ts";
import { Directory } from "../durable-objects/stream-directory.ts";
import { Signing } from "../durable-objects/stream-signing.ts";
import { Subscriptions } from "../durable-objects/stream-subscriptions.ts";
import { Streams } from "../durable-objects/streams.ts";

/** Where the streams are mounted. */
export const ROOT = "/streams";

/**
 * The address the hub gives its streams. Not one anybody can open: the hub is reached through
 * service bindings, where only the path counts. A subscriber is told where to acknowledge as a
 * path under it.
 */
export const ORIGIN = "https://hub";

// Who may call is decided by the middleware (the workers' token). Saying so here also stops
// anything caching what's read.
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

/** Add an event to a stream others follow: where it now ends, and the subscriptions told. */
export const publish = (stream: string, event: unknown) =>
  streams.append(bindings, ORIGIN, stream, event);

/** Wake every subscriber whose stream has gone past what it has acknowledged. */
export const recheckAll = () => streams.recheckAll(bindings, ORIGIN);

const JSON_TYPE = { "content-type": "application/json" };

/** A read stream nobody has read or written for this long is removed (30 days). */
const UNUSED_SECONDS = 30 * 24 * 60 * 60;

/** A stream by name: the object that holds it, asked directly. */
function streamOf(name: string) {
  const path = `${ROOT}/${name}`;
  const url = `${ORIGIN}${path}`;
  const object = Streams.get(path);
  return {
    /** Make the stream, if it isn't there yet. */
    create: () =>
      object.fetch(url, {
        method: "PUT",
        headers: { ...JSON_TYPE, "stream-ttl": String(UNUSED_SECONDS) },
      }),
    /** Several at once: a JSON stream takes an array as that many events, in order. */
    add: (events: unknown[]) =>
      object.fetch(url, { method: "POST", headers: JSON_TYPE, body: JSON.stringify(events) }),
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

/** Make a read stream with nothing in it, so a reader can wait on it. */
export const create = (name: string) => streamOf(name).create();

/**
 * Events added to the end of a read stream; the stream is made by its first event. Straight to
 * the stream's own object, without looking for subscribers, since these are written to the most.
 * `mark`: the place is noted (durable-objects/marks.ts), for recent() below.
 */
export async function append(name: string, events: unknown[], mark: boolean) {
  const stream = streamOf(name);
  if (mark) await Marks.get(name).mark(await stream.end());
  let added = await stream.add(events);
  if (added.status === 404) {
    await stream.create();
    added = await stream.add(events);
  }
  if (!added.ok) throw new Error(`Stream ${name}: ${added.status} ${await added.text()}`);
}

/** A read stream from its oldest mark kept, and the offset that goes up to. */
export async function recent(name: string) {
  return streamOf(name).since(await Marks.get(name).from());
}

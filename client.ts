// The hub's client, for the program's other workers: Durable Streams' own protocol, through a
// Cloudflare service binding or its address, with the Worker's API key. A stream is reached by its name ("signups",
// "admins"): its path under the hub's /v1/stream. Reads are the official client's
// (@durable-streams/client); a write is the protocol's POST, made by a PUT first if the stream
// isn't there yet, and read for the subscriptions it woke (src/server/subscriber.ts's toldOf).
// Following a stream is hub/bus.
//
// The hub's streams are in D1 with read replicas (src/streams.ts). Every answer carries
// a D1 bookmark; the client keeps the newest it has had and sends it with each request, as Void's
// guide has API clients do (guide/database/d1.md, "API requests with concurrent clients"). So a
// worker never reads older than what it has already read or written, wherever it runs.
import { FetchError, stream as read } from "@durable-streams/client";
import { toldOf } from "./src/server/subscriber.ts";

/**
 * Where the streams are, as the hub names itself: the protocol's reference path. Only the path
 * counts: the client sends each request to the hub it was given (a binding, or its address).
 */
export const STREAMS = "https://hub/v1/stream";

/** The D1 bookmark sent and answered (Void's header for it). */
const BOOKMARK = "x-db-bookmark";
/** "first-primary": read the primary, not a replica. */
const SESSION = "x-db-session";

const JSON_TYPE = { "content-type": "application/json" };

/**
 * `target`: how this worker reaches the hub. A service binding to it, for a worker deployed on the
 * same Cloudflare account; or its address (`https://durable-streams.<account>.workers.dev`), for
 * any other worker, local ones included. `key`: this Worker's API key, made by the hub (its Better Auth).
 */
export function hub(target: Pick<Fetcher, "fetch"> | string, key: string) {
  const origin = new URL(typeof target === "string" ? target : STREAMS).origin;
  const reach = (request: Request, init: RequestInit) =>
    typeof target === "string" ? fetch(request, init) : target.fetch(request, init);

  /** The newest D1 bookmark answered (they sort as they were made). */
  let newest: string | null = null;

  /**
   * A protocol request to the hub, as `fetch` takes one: only the path and query of its URL are
   * used. It carries the Worker's key, unless it has its own (a subscriber's answer to a wake
   * carries the wake's), and the newest bookmark.
   */
  const send: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const { pathname, search } = new URL(request.url);
    const headers = new Headers(request.headers);
    if (!headers.has("authorization")) headers.set("authorization", `Bearer ${key}`);
    if (newest !== null && !headers.has(BOOKMARK)) headers.set(BOOKMARK, newest);
    const response = await reach(new Request(new URL(pathname + search, origin), request), {
      headers,
    });
    const answered = response.headers.get(BOOKMARK);
    if (answered !== null && (newest === null || answered > newest)) newest = answered;
    return response;
  };

  const url = (stream: string) => `${STREAMS}/${stream}`;

  /** Make a JSON stream. Making one that's there already, the same, changes nothing. */
  async function create(stream: string): Promise<void> {
    const made = await send(url(stream), { method: "PUT", headers: JSON_TYPE });
    if (!made.ok) throw new Error(`hub: make ${stream}: ${made.status} ${await made.text()}`);
  }

  return {
    /** Protocol requests of any kind (the subscriber's: its keys, acknowledging a wake). */
    fetch: send,

    url,

    /**
     * Events added, in order, to the end of a stream (made by the first). Where it now ends, and
     * the subscriptions told of it.
     */
    async append(stream: string, events: unknown[]) {
      // A JSON stream takes an array as that many events.
      const post = () =>
        send(url(stream), { method: "POST", headers: JSON_TYPE, body: JSON.stringify(events) });
      let added = await post();
      if (added.status === 404) {
        await create(stream);
        added = await post();
      }
      if (!added.ok) throw new Error(`hub: write ${stream}: ${added.status} ${await added.text()}`);
      return {
        offset: added.headers.get("stream-next-offset") ?? "-1",
        subscriptions: toldOf(added),
      };
    },

    /**
     * A stream's events after `offset` (its start: "-1"), up to where it ends now, and that end.
     * A stream nothing has been written to yet has none. `primary`: read the primary, for a
     * writer's latest that the nearest replica may not have yet.
     */
    async read<Event = unknown>(stream: string, offset = "-1", { primary = false } = {}) {
      try {
        const response = await read<Event>({
          url: url(stream),
          offset,
          live: false,
          fetch: send,
          headers: primary ? { [SESSION]: "first-primary" } : {},
        });
        const events = await response.json<Event>();
        return { events, offset: response.offset };
      } catch (error) {
        if (error instanceof FetchError && error.status === 404)
          return { events: [] as Event[], offset };
        throw error;
      }
    },

    /**
     * A browser's read of a stream, passed on: the same query (offset, live), and of the
     * browser's headers only what the read needs. A stream not there yet is made, so the browser
     * can wait on it. The hub lets any worker read any stream: whether this browser may is for
     * the worker to decide first.
     */
    async pass(request: Request, stream: string): Promise<Response> {
      const headers = new Headers();
      for (const name of ["accept", "if-none-match", "last-event-id"]) {
        const value = request.headers.get(name);
        if (value) headers.set(name, value);
      }
      const target = `${url(stream)}${new URL(request.url).search}`;
      const get = () => send(target, { headers, signal: request.signal });
      const found = await get();
      if (found.status !== 404) return found;
      await create(stream);
      return get();
    },

    /**
     * Follow streams: make sure this subscription is there (the protocol's own request). `wake`:
     * this worker's own address for wakes, which the hub sends there signed.
     */
    async subscribe(id: string, follow: { streams: string[]; wake: string; description: string }) {
      const res = await send(`${STREAMS}/__ds/subscriptions/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: JSON_TYPE,
        body: JSON.stringify({
          type: "webhook",
          streams: follow.streams,
          webhook: { url: follow.wake },
          // How long the worker has to deal with a wake before it's sent again.
          lease_ttl_ms: 60_000,
          description: follow.description,
        }),
      });
      if (!res.ok) throw new Error(`hub: subscription ${id}: ${res.status} ${await res.text()}`);
    },
  };
}

export type Hub = ReturnType<typeof hub>;

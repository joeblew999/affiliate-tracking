// The hub's client for the program's other workers. Calls go through a Cloudflare service binding
// and carry HUB_TOKEN. Their input and output types come from src/contract.ts, which the hub's
// routes also check against, so nothing is written twice and a worker's type check never pulls in
// the hub's code.
import type { z } from "zod";
import {
  AppendInput,
  AppendOutput,
  PublishInput,
  PublishOutput,
  RecentInput,
  RecentOutput,
} from "./src/contract.ts";

/** Where the streams are, as the hub names itself. Only the path counts: it's reached by binding. */
export const STREAMS = "https://hub/streams";

/** `binding`: the service binding to the hub. */
export function hub(binding: Pick<Fetcher, "fetch">, token: string) {
  /** A request to the hub: only the path of `url` is used; the workers' token unless it has its own. */
  function send(url: string | URL, init: RequestInit = {}): Promise<Response> {
    const { pathname, search } = new URL(url, STREAMS);
    const headers = new Headers(init.headers);
    // A subscriber's answer to a wake carries the wake's own token; anything else, the workers'.
    if (!headers.has("authorization")) headers.set("authorization", `Bearer ${token}`);
    return binding.fetch(new Request(new URL(pathname + search, STREAMS), { ...init, headers }));
  }

  async function call<I extends z.ZodType, O extends z.ZodType>(
    path: string,
    input: I,
    output: O,
    body: z.input<I>,
  ): Promise<z.output<O>> {
    const res = await send(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input.parse(body)),
    });
    if (!res.ok) throw new Error(`hub ${path}: ${res.status} ${await res.text()}`);
    return output.parse(await res.json());
  }

  return {
    /**
     * The streams' own protocol (reading on, acknowledging a wake, a subscription, the signing
     * keys), for packages/streams' subscriber helpers, which take this as their fetch.
     */
    streams: send,

    /**
     * A browser's read of a stream, passed on to the hub: the same query (offset, live), none of
     * the browser's own headers but what the read needs. The hub lets any worker read any stream:
     * whether this browser may is for the worker to decide first.
     */
    read(request: Request, stream: string): Promise<Response> {
      const headers = new Headers();
      for (const name of ["accept", "if-none-match", "last-event-id"]) {
        const value = request.headers.get(name);
        if (value) headers.set(name, value);
      }
      return send(`/streams/${stream}${new URL(request.url).search}`, {
        headers,
        signal: request.signal,
      });
    },

    /** Events added to streams that are read, not followed. `mark`: note the place, for recent(). */
    append: (streams: string[], events: unknown[], mark = false) =>
      call("/api/append", AppendInput, AppendOutput, { streams, events, mark }),

    /** A read stream's latest events (from its oldest mark kept), and the offset they go up to. */
    recent: (stream: string) => call("/api/recent", RecentInput, RecentOutput, { stream }),

    /** One event added to a stream others follow: where it now ends, and the subscriptions told. */
    publish: (stream: string, event: unknown) =>
      call("/api/publish", PublishInput, PublishOutput, { stream, event }),

    /**
     * Follow streams: make sure this subscription is there (the protocol's own request). `wake`:
     * this worker's own address for wakes, which the hub sends there signed (check each with
     * packages/streams' wakeIsSigned, against the hub's keys).
     */
    async subscribe(id: string, follow: { streams: string[]; wake: string; description: string }) {
      const res = await send(`/streams/__ds/subscriptions/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "webhook",
          streams: follow.streams,
          webhook: { url: follow.wake },
          // How long the worker has to deal with a wake before it's sent again.
          lease_ttl_ms: 60_000,
          description: follow.description,
        }),
      });
      if (!res.ok) throw new Error(`hub subscription ${id}: ${res.status} ${await res.text()}`);
    },
  };
}

export type Hub = ReturnType<typeof hub>;

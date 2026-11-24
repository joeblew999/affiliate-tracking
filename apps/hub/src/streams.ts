// The hub's streams: Durable Streams, with the protocol's subscriptions (packages/streams), at
// /streams. All of it is the protocol: a worker makes a stream (PUT), writes to it (POST), reads it
// (GET, caught up or live) and follows it (a subscription under /streams/__ds). A write's answer
// also names the subscriptions told of it (packages/streams' SUBSCRIPTIONS_HEADER).
//
// The streams themselves are in the hub's D1 (streams/d1): any of the hub's Workers, wherever it
// runs, reads a stream from the nearest read replica, and writes go to the primary. Each answer
// carries the newest D1 bookmark (X-DB-Bookmark), which the hub's client sends back, so no client
// reads older than what it has seen. Live readers wait on a notifier per stream.
import { env } from "cloudflare:workers";
import { createStreams } from "streams";
import { sweepExpired } from "streams/d1";
import { Directory } from "../durable-objects/stream-directory.ts";
import { Signing } from "../durable-objects/stream-signing.ts";
import { Subscriptions } from "../durable-objects/stream-subscriptions.ts";
import { d1, d1Streams, type Bindings } from "./d1.ts";

/** Where the streams are mounted. */
export const ROOT = "/streams";

/**
 * The address the hub gives its streams. Not one anybody can open: the hub is reached through
 * service bindings, where only the path counts. A subscriber is told where to acknowledge as a
 * path under it.
 */
export const ORIGIN = "https://hub";

const streams = createStreams({
  root: ROOT,
  streams: d1Streams,
  subscriptions: Subscriptions,
  directory: Directory,
  signing: Signing,
});

const bindings = env as unknown as Bindings;

/** A request to the streams, already allowed. */
export const serve = (request: Request) => streams.handle(request, bindings as never);

/** Wake every subscriber whose stream has gone past what it has acknowledged. */
export const recheckAll = () => streams.recheckAll(bindings as never, ORIGIN);

/** Remove every stream past its expiry (a read would, on finding it). */
export const sweep = () => sweepExpired(d1, bindings, ORIGIN);

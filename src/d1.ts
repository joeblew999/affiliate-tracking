// The hub's streams in its D1 (src/server/d1): the protocol's server, which the routes (src/streams.ts)
// and the subscriptions (durable-objects/stream-subscriptions.ts, writing a pull-wake's wake
// events) both write through. Its own module, so neither imports the other.
import { createD1Streams, type D1StreamsOptions, type StreamNotifier } from "./server/d1/index.ts";
import { Notifier } from "../durable-objects/stream-notifier.ts";

/** What the server needs of the Worker's bindings. */
export type Bindings = { DB: D1Database; STREAM_NOTIFIER: DurableObjectNamespace<StreamNotifier> };

export const d1: D1StreamsOptions<Bindings> = {
  database: (bindings) => bindings.DB,
  // From the bindings given, so it works in a durable object's code as in a request's.
  notifier: (bindings, path) => Notifier.get(bindings.STREAM_NOTIFIER, path),
  // The protocol's CORS headers: a browser may call the hub too, with the token like anyone.
  cors: true,
};

export const d1Streams = createD1Streams(d1);

// The hub's streams in its D1 (streams/d1): the protocol's server, which the routes (src/streams.ts)
// and the subscriptions (durable-objects/stream-subscriptions.ts, writing a pull-wake's wake
// events) both write through. Its own module, so neither imports the other.
import { createD1Streams, type D1StreamsOptions, type StreamNotifier } from "streams/d1";
import { Notifier } from "../durable-objects/stream-notifier.ts";

/** What the server needs of the Worker's bindings. */
export type Bindings = { DB: D1Database; STREAM_NOTIFIER: DurableObjectNamespace<StreamNotifier> };

export const d1: D1StreamsOptions<Bindings> = {
  database: (bindings) => bindings.DB,
  // From the bindings given, so it works in a durable object's code as in a request's.
  notifier: (bindings, path) => Notifier.get(bindings.STREAM_NOTIFIER, path),
  // Only workers call the hub (middleware/01.workers.ts), never a browser directly.
  cors: false,
};

export const d1Streams = createD1Streams(d1);

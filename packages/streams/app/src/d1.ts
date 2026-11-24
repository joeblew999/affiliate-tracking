// The app's streams in its D1 (streams/d1): the protocol's server, which the route and the
// subscriptions (writing a pull-wake's wake events) both write through. Its own module, so neither
// imports the other.
import { createD1Streams, type StreamNotifier } from "streams/d1";
import { Notifier } from "../durable-objects/stream-notifier.ts";

export type Bindings = { DB: D1Database; STREAM_NOTIFIER: DurableObjectNamespace<StreamNotifier> };

export const d1Streams = createD1Streams<Bindings>({
  database: (bindings) => bindings.DB,
  notifier: (bindings, path) => Notifier.get(bindings.STREAM_NOTIFIER, path),
});

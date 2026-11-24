// The streams (Durable Streams, @durable-streams/server-cloudflare): each stream is one of these
// objects, keeping its events in its own SQLite. Their code looks the objects up through a binding
// named STREAMS, which is the name Void gives this file's.
import { StreamObject } from "@durable-streams/server-cloudflare";
import { defineDurableObject } from "void/durable";

export const Streams = defineDurableObject({ name: "streams", class: StreamObject });
export default Streams;

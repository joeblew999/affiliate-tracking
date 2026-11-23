// Each stream: the protocol server's own Durable Object. It looks itself up through a binding
// named STREAMS, which is the name Void gives this file's.
import { StreamObject } from "@durable-streams/server-cloudflare";
import { defineDurableObject } from "void/durable";

export const Streams = defineDurableObject({ name: "streams", class: StreamObject });
export default Streams;

// Each stream's live readers, told when it has moved on (packages/streams' d1/notifier.ts): one
// object per stream, holding no data. The streams themselves are in the hub's D1.
import { StreamNotifier } from "streams/d1";
import { defineDurableObject } from "void/durable";

export const Notifier = defineDurableObject({ name: "stream-notifier", class: StreamNotifier });
export default Notifier;

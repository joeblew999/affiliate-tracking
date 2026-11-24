// Each stream's live readers, told when it has moved on (src/server/d1/notifier.ts): one
// object per stream, holding no data. The streams themselves are in the hub's D1.
import { StreamNotifier } from "../src/server/d1/index.ts";
import { defineDurableObject } from "void/durable";

export const Notifier = defineDurableObject({ name: "stream-notifier", class: StreamNotifier });
export default Notifier;

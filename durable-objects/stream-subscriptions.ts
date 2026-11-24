// Each subscription to a stream (src/server): what a subscriber follows, how far it has
// acknowledged, and its wakes. The hub doesn't know its subscribers: each gives the address to wake
// it at when it subscribes, and the wake is sent there, signed (the protocol's webhook). The
// subscriber knows it's the hub's by the signature. A pull-wake's wake events are written to its
// wake stream through the streams' own server (src/d1.ts). A delivery by one route (src/push.ts)
// is woken here, in process: the hub reads for it and sends the events on.
import { defineDurableState } from "void/durable";
import { subscriptionState } from "../src/server/index.ts";
import { d1Streams, type Bindings } from "../src/d1.ts";
import { deliver } from "../src/push.ts";

export const Subscriptions = defineDurableState(
  subscriptionState({
    write: (env, request) => d1Streams(request, env as Bindings),
    deliver: async (env, url, init) =>
      (await deliver(env as Bindings, url, init)) ?? fetch(url, init),
  }),
);
export default Subscriptions;

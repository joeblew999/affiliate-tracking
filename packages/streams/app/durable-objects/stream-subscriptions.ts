// Each subscription (packages/streams), its pull-wake events written through the app's streams
// server (src/d1.ts).
import { defineDurableState } from "void/durable";
import { subscriptionState } from "streams";
import { d1Streams, type Bindings } from "../src/d1.ts";

export const Subscriptions = defineDurableState(
  subscriptionState({ write: (env, request) => d1Streams(request, env as Bindings) }),
);
export default Subscriptions;

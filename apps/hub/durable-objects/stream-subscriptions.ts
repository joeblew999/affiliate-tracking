// Each subscription to a stream (packages/streams): what a subscriber follows, how far it has
// acknowledged, and its wakes. The hub doesn't know its subscribers: each gives the address to wake
// it at when it subscribes, and the wake is sent there, signed (the protocol's webhook). The
// subscriber knows it's the hub's by the signature.
import { defineDurableState } from "void/durable";
import { subscriptionState } from "streams";

export const Subscriptions = defineDurableState(subscriptionState());
export default Subscriptions;

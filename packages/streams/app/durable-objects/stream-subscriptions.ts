// Each subscription (packages/streams/src/subscription.ts).
import { defineDurableState } from "void/durable";
import { subscriptionState } from "streams";

export const Subscriptions = defineDurableState(subscriptionState());
export default Subscriptions;

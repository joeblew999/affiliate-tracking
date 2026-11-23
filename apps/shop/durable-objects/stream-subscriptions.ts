// Each subscription to a stream (packages/streams): what a subscriber follows, how far it has
// acknowledged, and its wakes. The subscriber here is the affiliate service, so a wake goes to it
// through its binding, with the shop's token, as every call to it does.
import { defineDurableState } from "void/durable";
import { env as vars } from "void/env";
import { subscriptionState } from "streams";

export const Subscriptions = defineDurableState(
  subscriptionState({
    deliver: (env, url, init) =>
      (env.AFFILIATES as Fetcher).fetch(url, {
        ...init,
        headers: {
          ...(init.headers as Record<string, string>),
          authorization: `Bearer ${vars.AFFILIATES_HOST_TOKEN}`,
        },
      }),
  }),
);
export default Subscriptions;

// Things that happened in the shop, for other workers to react to. Each kind is a stream in the
// hub (src/hub.ts). A worker that cares follows the stream with a subscription of its own: it's
// woken when there's something new, reads on from where it had got to, and acknowledges. The shop
// doesn't call it, wait for it or know who it is.
//
// publish() from anywhere: the event goes onto the shop's queue (queues/published.ts) first, so
// what's publishing never waits on the hub or fails because of it, and a failed write is tried
// again.
import { publishNow } from "activity/bus";
import { SIGNUPS_STREAM, STRIPE_STREAM, type Signup } from "affiliates/client";
import type Stripe from "stripe";
import { queues } from "./activity.ts";
import { hub } from "./hub.ts";

/** What the shop publishes: the stream it goes to, what it's called, and what it says. */
export type Published =
  // A new user, with the referral cookie's value if their browser had one.
  | { stream: typeof SIGNUPS_STREAM; type: "signed-up"; data: Signup }
  // An event from Stripe's webhook (Better Auth's Stripe plugin has checked its signature).
  | { stream: typeof STRIPE_STREAM; type: "stripe-event"; data: Stripe.Event };

export const publish = (event: Published) => queues.published.send(event);

/** Write an event to its stream now (the queue's consumer). */
export const write = ({ stream, type, data }: Published) => publishNow(hub, stream, type, data);

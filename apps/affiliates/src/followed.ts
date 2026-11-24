// What this service follows of the host's, over the hub (src/hub.ts), and what it does with each
// event. The hub wakes it at routes/api/hub/wake.ts, and queues/wakes.ts reads on and acknowledges
// (hub/bus).
import { carried } from "activity/server";
import { follower, follows } from "hub/bus";
import { env } from "void/env";
import { SIGNUPS_STREAM, SignupInput, STRIPE_STREAM, StripeEventInput } from "./host-contract.ts";
import { hub } from "./hub.ts";
import { recordSignupReferral } from "./referrals.ts";
import { stripeEvent } from "./stripe-events.ts";

export const followed = follower({
  hub,
  wakeUrl: new URL("/api/hub/wake", env.AFFILIATES_SITE_URL).href,
  // Each event's part is a step of the action it came from.
  carry: carried,
  subscriptions: {
    "affiliates-signups": follows({
      stream: SIGNUPS_STREAM,
      data: SignupInput,
      title: "Sign-up recorded",
      description: "The affiliate service, told of each new user",
      // A new user on the host: theirs becomes the referring partner's, if a referral brought
      // them. (Recording it again changes nothing: src/referrals.ts.)
      work: async ({ userId, ref }) => {
        await recordSignupReferral(userId, ref);
      },
    }),
    "affiliates-stripe": follows({
      stream: STRIPE_STREAM,
      data: StripeEventInput,
      title: "Sales counted",
      description: "The affiliate service, told of each Stripe event",
      work: stripeEvent,
    }),
  },
});

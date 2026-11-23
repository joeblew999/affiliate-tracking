// What the host app and this service say to each other (/api/host/*), in one place: the routes
// validate against these and return values that satisfy them, and client.ts takes its types from
// them. Only zod here, so the host's type check never pulls in this service's code.
import type Stripe from "stripe";
import { z } from "zod";

/**
 * The referral cookie: set by this service's referral links for the parent domain, so the host's site
 * receives it too and passes its value on at signup and checkout.
 */
export const REF_COOKIE = "affiliate_ref";

const userId = z.string().min(1).max(255);
const ref = z.string().max(512).nullable();

export const SignupInput = z.object({ userId, ref });

/**
 * A user signed up on the host. Not a call: the host writes each one to a stream (Durable Streams,
 * packages/streams), and this service follows that stream with a subscription. So a sign-up is
 * kept in order whether or not this service is up, and it's this service that says how far it
 * has got.
 */
export const SIGNUPS_STREAM = "events/signups";
export const SIGNUPS_SUBSCRIPTION = "affiliates-signups";
export const SignedUp = z.object({
  /** The event's own id. */
  id: z.string(),
  type: z.literal("signed-up"),
  /** With the referral cookie's value if the browser had one (client.ts: referralFrom). */
  data: SignupInput,
  /** The action the sign-up is part of, for the control plane (packages/activity). */
  activity: z.object({ actionId: z.string(), viewers: z.array(z.string()) }).nullable(),
});
export type SignedUp = z.output<typeof SignedUp>;

export const CheckoutInput = z.object({
  userId: userId.nullable(),
  ref,
  /** A promotion code the customer typed, if the host lets them. */
  promoCode: z.string().trim().max(64).nullable(),
  /** The buyer's IP, for the self-referral check (only its salted hash is kept). */
  ip: z.string().max(64).nullable(),
  /** The event the ticket is for (events()): its organiser gets their share of it. */
  eventId: z.string().max(64).nullable().default(null),
});
export const CheckoutOutput = z.object({
  /** Add to the Checkout Session's metadata (and a subscription's). */
  metadata: z.record(z.string(), z.string()),
  /** The partner's buyer discount: a Stripe promotion code id for discounts[0].promotion_code. */
  promotionCode: z.string().nullable(),
});

/**
 * A Stripe event, already verified by the host's Better Auth Stripe plugin (its onEvent): typed as
 * Stripe's own Event, with its outline checked.
 */
export const StripeEventInput = z.custom<Stripe.Event>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "id") === "string" &&
    typeof Reflect.get(value, "type") === "string" &&
    typeof Reflect.get(value, "data") === "object",
  "a Stripe event",
);
export const StripeEventOutput = z.object({ received: z.literal(true) });

/** The events on sale (their venue paid), soonest first, for the host's pages. */
export const EventsInput = z.object({});
export const Event = z.object({
  id: z.string(),
  /** Its Stripe product in the selling account: a ticket's line item. */
  productId: z.string(),
  name: z.string(),
  description: z.string(),
  startsAt: z.number(),
  endsAt: z.number(),
  /** Where: the venue's. */
  location: z.string(),
  priceCents: z.number(),
  currency: z.string(),
  /** Places left at the venue. */
  placesLeft: z.number(),
});
export const EventsOutput = z.object({ events: z.array(Event) });

/**
 * The service to the host: an event's venue is paid and it's on sale, so the host tells its users.
 * Through the host's binding, with the same AFFILIATES_HOST_TOKEN.
 */
export const OnSaleInput = z.object({ event: Event });
export const OnSaleOutput = z.object({ queued: z.literal(true) });

export type Event = z.output<typeof Event>;
export type EventsOutput = z.output<typeof EventsOutput>;
export type OnSaleOutput = z.output<typeof OnSaleOutput>;
export type StripeEventOutput = z.output<typeof StripeEventOutput>;
export type CheckoutOutput = z.output<typeof CheckoutOutput>;

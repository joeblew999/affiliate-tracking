// What the host app and this service say to each other (/api/host/*), in one place: the routes
// validate against these and return values that satisfy them, and client.ts takes its types from
// them. Only zod here, so the host's type check never pulls in this service's code.
import type Stripe from "stripe";
import { z } from "zod";

/**
 * This service's client id with the host's OAuth provider: people sign in to the service with the
 * host (Better Auth's OAuth provider there, generic OAuth here).
 */
export const OAUTH_CLIENT_ID = "affiliates";

/** The header the host's calls carry AFFILIATES_HOST_TOKEN in. */
export const HOST_TOKEN_HEADER = "x-affiliates-host-token";

/**
 * The referral cookie: set by this service's referral links for the parent domain, so the host's site
 * receives it too and passes its value on at signup and checkout.
 */
export const REF_COOKIE = "affiliate_ref";

const userId = z.string().min(1).max(255);
const ref = z.string().max(512).nullable();

export const SignupInput = z.object({ userId, ref });
export const SignupOutput = z.object({ userId, referred: z.boolean() });

export const CheckoutInput = z.object({
  userId: userId.nullable(),
  ref,
  /** A promotion code the customer typed, if the host lets them. */
  promoCode: z.string().trim().max(64).nullable(),
  /** The buyer's IP, for the self-referral check (only its salted hash is kept). */
  ip: z.string().max(64).nullable(),
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

export type SignupOutput = z.output<typeof SignupOutput>;
export type StripeEventOutput = z.output<typeof StripeEventOutput>;
export type CheckoutOutput = z.output<typeof CheckoutOutput>;

// Stripe's own SDK, typed, on the Workers runtime (fetch and Web Crypto).
import Stripe from "stripe";
import { env } from "void/env";

export function stripe(): Stripe {
  if (!env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY isn't set");
  return new Stripe(env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });
}

export function hasStripe(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY);
}

const crypto = Stripe.createSubtleCryptoProvider();

/** The event, if Stripe signed it with this endpoint's secret; null otherwise. */
export async function verifiedEvent(
  payload: string,
  signature: string | null,
): Promise<Stripe.Event | null> {
  if (!signature) return null;
  try {
    return await Stripe.webhooks.constructEventAsync(
      payload,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
      undefined,
      crypto,
    );
  } catch {
    return null;
  }
}

/** A Stripe object or its id, as an id. */
export function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

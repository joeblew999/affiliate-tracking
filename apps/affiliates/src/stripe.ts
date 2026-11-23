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

/** A Stripe object or its id, as an id. */
export function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/**
 * The payment intent that paid an invoice: the one a refund or dispute will name. A subscription's
 * Checkout Session has none of its own: its payment is its first invoice's.
 */
export async function invoicePaymentIntent(
  invoice: string | Stripe.Invoice,
): Promise<string | null> {
  if (typeof invoice !== "string")
    for (const payment of invoice.payments?.data ?? []) {
      const id = idOf(payment.payment.payment_intent);
      if (id) return id;
    }
  const id = typeof invoice === "string" ? invoice : invoice.id;
  if (!id || !hasStripe()) return null;
  const listed = await stripe().invoicePayments.list({ invoice: id, limit: 10 });
  for (const payment of listed.data) {
    const intent = idOf(payment.payment.payment_intent);
    if (intent) return intent;
  }
  return null;
}

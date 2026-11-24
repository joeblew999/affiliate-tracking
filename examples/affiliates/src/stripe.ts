// Stripe's own SDK, typed, on the Workers runtime (fetch and Web Crypto), for the business's two
// accounts (env.ts): the selling account, which has the sales, and the payouts account, which
// pays partners through Connect. Each call names which one it's for.
import Stripe from "stripe";
import { env } from "void/env";

function client(key: string | undefined, name: string): Stripe {
  if (!key) throw new Error(`${name} isn't set`);
  return new Stripe(key, { httpClient: Stripe.createFetchHttpClient() });
}

/** The selling account: its sales, refunds, settled exchange rates and promotion codes. */
export const salesStripe = () => client(env.STRIPE_SALES_KEY, "STRIPE_SALES_KEY");
export const hasSalesStripe = () => Boolean(env.STRIPE_SALES_KEY);

/** The payouts account: partners' Connect accounts, top-ups and transfers. */
export const payoutsStripe = () => client(env.STRIPE_PAYOUTS_KEY, "STRIPE_PAYOUTS_KEY");
export const hasPayoutsStripe = () => Boolean(env.STRIPE_PAYOUTS_KEY);

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
  if (!id || !hasSalesStripe()) return null;
  const listed = await salesStripe().invoicePayments.list({ invoice: id, limit: 10 });
  for (const payment of listed.data) {
    const intent = idOf(payment.payment.payment_intent);
    if (intent) return intent;
  }
  return null;
}

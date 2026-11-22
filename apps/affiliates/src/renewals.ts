// Commission on subscription renewals: Stripe's invoice.paid (routes/api/host/stripe-event.ts, from the host's Stripe webhook). A
// renewal pays the partner who got the subscription's first sale, under the same commission rules,
// for the partner's recurringMonths (else AFFILIATES_RECURRING_MONTHS, default 12) after the first
// sale. The first invoice of a new subscription is skipped: its Checkout sale is that payment. A
// renewal carries the first sale's link, user and fraud flag, so a self-referred subscription's
// renewals are never approved automatically. Idempotent by invoice.
import { partners, sales } from "@schema";
import type Stripe from "stripe";
import { and, asc, db, eq, or, sql } from "void/db";
import { env } from "void/env";
import { computeCommission } from "./commission";
import { applyRefunds } from "./refunds";
import { hasStripe, idOf, stripe } from "./stripe";

const DEFAULT_RECURRING_MONTHS = 12;

export function recurringMonths(partner: { recurringMonths: number | null }): number {
  if (partner.recurringMonths !== null) return partner.recurringMonths;
  return env.AFFILIATES_RECURRING_MONTHS ?? DEFAULT_RECURRING_MONTHS;
}

/** The same day N calendar months later (the month's last day when it has no such day). */
function addMonths(at: number, months: number): number {
  const date = new Date(at);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.getTime();
}

/** The invoice's subscription: Stripe moved it in API version 2025-03-31.basil; both are read. */
function subscriptionOf(invoice: Stripe.Invoice): string | null {
  const legacy: unknown = Reflect.get(invoice, "subscription");
  const fromLegacy = typeof legacy === "string" ? legacy : null;
  return fromLegacy ?? idOf(invoice.parent?.subscription_details?.subscription);
}

/** The payment intent that paid the invoice (the one a refund or dispute will name). */
async function paymentIntentOf(invoice: Stripe.Invoice): Promise<string | null> {
  for (const payment of invoice.payments?.data ?? []) {
    const id = idOf(payment.payment.payment_intent);
    if (id) return id;
  }
  if (!hasStripe()) return null;
  const listed = await stripe().invoicePayments.list({ invoice: invoice.id ?? "", limit: 10 });
  for (const payment of listed.data) {
    const id = idOf(payment.payment.payment_intent);
    if (id) return id;
  }
  return null;
}

type RenewalResult = { recorded: true; saleId: string } | { recorded: false; reason: string };

export async function recordRenewal(
  invoice: Stripe.Invoice,
  event: Stripe.Event,
): Promise<RenewalResult> {
  if (!invoice.id) return { recorded: false, reason: "no invoice id" };
  if (invoice.billing_reason === "subscription_create")
    return { recorded: false, reason: "first invoice: the checkout sale" };
  if (!invoice.amount_paid || invoice.amount_paid <= 0)
    return { recorded: false, reason: "nothing paid" };
  const subscription = subscriptionOf(invoice);
  const customer = idOf(invoice.customer);
  if (!subscription && !customer) return { recorded: false, reason: "no subscription or customer" };

  // The sale that started it: the subscription's checkout sale, else the customer's first.
  const [first] = await db
    .select({ sale: sales, partner: partners })
    .from(sales)
    .innerJoin(partners, eq(partners.id, sales.partnerId))
    .where(
      and(
        eq(sales.kind, "checkout"),
        or(
          subscription ? eq(sales.stripeSubscriptionId, subscription) : sql`0`,
          customer ? eq(sales.stripeCustomerId, customer) : sql`0`,
        ),
      ),
    )
    .orderBy(
      sql`CASE WHEN ${sales.stripeSubscriptionId} = ${subscription} THEN 0 ELSE 1 END`,
      asc(sales.createdAt),
    )
    .limit(1);
  if (!first) return { recorded: false, reason: "no first sale" };
  if (first.partner.status !== "active") return { recorded: false, reason: "partner not active" };

  const paidAt = (invoice.status_transitions.paid_at ?? event.created) * 1000;
  if (paidAt >= addMonths(first.sale.createdAt, recurringMonths(first.partner))) {
    return { recorded: false, reason: "past the partner's recurring months" };
  }
  const currency = invoice.currency.toLowerCase();
  const lines = invoice.lines.data;
  const items = lines.map((line) => ({
    productId: idOf(line.pricing?.price_details?.product),
    name: line.description,
    variant: null,
    quantity: line.quantity ?? 1,
  }));
  const commission = await computeCommission(first.partner, {
    amountCents: invoice.amount_paid,
    currency,
    customerEmail: invoice.customer_email,
    at: paidAt,
    items: lines.map((line, i) => ({
      productId: items[i]?.productId ?? null,
      priceId: idOf(line.pricing?.price_details?.price),
      quantity: line.quantity ?? 1,
      amountCents: line.amount,
    })),
  });
  const paymentIntent = await paymentIntentOf(invoice);
  const country = invoice.customer_address?.country ?? null;
  const [row] = await db
    .insert(sales)
    .values({
      partnerId: first.partner.id,
      kind: "renewal",
      stripeInvoiceId: invoice.id,
      stripeEventId: event.id,
      paymentIntent,
      stripeCustomerId: customer,
      stripeSubscriptionId: subscription,
      userId: first.sale.userId,
      linkId: first.sale.linkId,
      customerEmail: invoice.customer_email,
      customerCountry: country,
      amountCents: invoice.amount_paid,
      currency,
      commissionCents: commission.commissionCents,
      grossCommissionCents: commission.commissionCents,
      commissionPct: commission.commissionPct,
      commissionDetail: commission.detail,
      items,
      fraudReason: first.sale.fraudReason,
      createdAt: paidAt,
    })
    .onConflictDoNothing({ target: sales.stripeInvoiceId })
    .returning({ id: sales.id });
  if (!row) return { recorded: false, reason: "already recorded" };
  if (paymentIntent) await applyRefunds(paymentIntent);
  return { recorded: true, saleId: row.id };
}

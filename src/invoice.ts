// Recurring commissions.
//
// Subscribe your webhook to invoice.paid and call this in its verified branch,
// awaiting it before acknowledging Stripe:
//
//   if (event.type === 'invoice.paid') await recordInvoicePayment(event.data.object, event, env);
//
// A renewal pays the affiliate who got the subscription's first sale (the
// Checkout conversion recordConversion stored), under the same commission rules, for
// recurring_months months after the first sale. The first invoice of a new
// subscription is skipped: its Checkout session is the sale. Idempotent by
// invoice id. Refunds and disputes of a renewal cancel only that renewal,
// through recordRefund as before.

import type { AffiliateEnv, AffiliatesRow, ConversionsRow, StripeEvent, StripeObject } from './types.ts';
import { currencyCode } from './money.ts';
import { stripeId, stripeRequest } from './stripe.ts';
import { computeCommission } from './rules.ts';

export const DEFAULT_RECURRING_MONTHS = 12;

export function recurringMonths(affiliate: Pick<AffiliatesRow, 'recurring_months'> | null | undefined, env: AffiliateEnv | undefined): number {
    const own = affiliate?.recurring_months;
    if (typeof own === 'number' && Number.isSafeInteger(own) && own >= 0) return own;
    const raw = env?.AFFILIATE_RECURRING_MONTHS;
    if (raw === undefined || raw === null || raw === '') return DEFAULT_RECURRING_MONTHS;
    const months = Number(raw);
    if (!Number.isSafeInteger(months) || months < 0 || months > 1200) {
        throw new Error('AFFILIATE_RECURRING_MONTHS must be a whole number of months from 0 to 1200');
    }
    return months;
}

// The same day N calendar months later (clamped to the month's last day).
export function addMonths(timestamp: number, months: number): number {
    const date = new Date(timestamp);
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + months);
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, lastDay));
    return date.getTime();
}

// Stripe moved these fields in API version 2025-03-31.basil; read both shapes.
export function invoiceSubscription(invoice: StripeObject | null | undefined): string | null {
    return stripeId(invoice?.subscription) || stripeId(invoice?.parent?.subscription_details?.subscription);
}

export async function invoicePaymentIntent(invoice: StripeObject | null | undefined, env: AffiliateEnv): Promise<string | null> {
    const direct = stripeId(invoice?.payment_intent);
    if (direct) return direct;
    for (const row of invoice?.payments?.data || []) {
        const id = stripeId(row?.payment?.payment_intent);
        if (id) return id;
    }
    if (!invoice?.id || !env.STRIPE_SECRET_KEY) return null;
    // Only the id is known (a Checkout session's invoice): read the invoice,
    // which carries payment_intent on API versions before 2025-03-31.basil.
    if (invoice.object !== 'invoice') {
        const full = await stripeRequest(env, `invoices/${encodeURIComponent(invoice.id)}`);
        const id = stripeId(full?.payment_intent);
        if (id) return id;
    }
    const payments = await stripeRequest(env, `invoice_payments?invoice=${encodeURIComponent(invoice.id)}&limit=10`);
    for (const row of payments?.data || []) {
        const id = stripeId(row?.payment?.payment_intent);
        if (id) return id;
    }
    return null;
}

export async function recordInvoicePayment(invoice: StripeObject | null | undefined, event: StripeEvent | null | undefined, env: AffiliateEnv)
    : Promise<{ affiliate_id: number; commission_cents: number } | null> {
    if (!invoice?.id || invoice.object && invoice.object !== 'invoice') return null;
    if (!env.DB) throw new Error('Affiliate DB is not configured');
    const db = env.DB;
    // The subscription's first invoice is the Checkout sale itself.
    if (invoice.billing_reason === 'subscription_create') return null;
    const amount = Number.isFinite(invoice.amount_paid) ? invoice.amount_paid : 0;
    if (amount <= 0) return null;

    const existing = await env.DB.prepare('SELECT id FROM conversions WHERE stripe_invoice_id=?1').bind(invoice.id).first();
    if (existing) return null;

    const subscription = invoiceSubscription(invoice);
    const customer = stripeId(invoice.customer);
    if (!subscription && !customer) return null;
    // The sale that started it: the subscription's Checkout conversion, or
    // failing that the customer's first attributed one.
    const first = await env.DB.prepare(`
        SELECT c.affiliate_id, c.created_at, c.link_id, c.user_id, c.fraud_reason,
               a.commission_pct, a.status, a.recurring_months
        FROM conversions c JOIN affiliates a ON a.id=c.affiliate_id
        WHERE c.kind='checkout' AND (
            (?1 IS NOT NULL AND c.stripe_subscription_id=?1) OR
            (?2 IS NOT NULL AND c.stripe_customer_id=?2))
        ORDER BY CASE WHEN c.stripe_subscription_id=?1 THEN 0 ELSE 1 END, c.created_at, c.id
        LIMIT 1`).bind(subscription, customer).first<
            Pick<ConversionsRow, 'affiliate_id' | 'created_at' | 'link_id' | 'user_id' | 'fraud_reason'> &
            Pick<AffiliatesRow, 'commission_pct' | 'status' | 'recurring_months'>>();
    if (!first || first.status !== 'active') return null;

    const paidAt = Number.isFinite(invoice.status_transitions?.paid_at) ? invoice.status_transitions.paid_at * 1000
        : typeof event?.created === 'number' && Number.isFinite(event.created) ? event.created * 1000 : Date.now();
    const months = recurringMonths(first, env);
    if (paidAt >= addMonths(first.created_at, months)) return null;

    const paymentIntent = await invoicePaymentIntent(invoice, env);
    const lines: StripeObject[] = invoice.lines?.data || [];
    const items = lines.map(line => {
        const product = line.price?.product ?? line.pricing?.price_details?.product;
        return {
            product_id: typeof product === 'string' ? product : product?.id || null,
            name: line.description || product?.name || null,
            variant: line.price?.nickname || null,
            quantity: line.quantity || 1,
        };
    });
    const country = invoice.customer_address?.country;
    // Renewals go through the same commission rules as the first sale
    // (per product, tiers, caps per customer).
    const { commission, pct, detail } = await computeCommission({ ...env, DB: db }, {
        affiliate: { id: first.affiliate_id, commission_pct: first.commission_pct },
        amountCents: amount, currency: currencyCode(invoice.currency), customerEmail: invoice.customer_email || null,
        at: paidAt,
        items: lines.map((line, i) => ({
            product_id: items[i].product_id, price_id: stripeId(line.price ?? line.pricing?.price_details?.price),
            quantity: items[i].quantity, amount_cents: line.amount,
        })),
    });
    const result = await env.DB.prepare(`
        INSERT INTO conversions
          (affiliate_id, stripe_session_id, stripe_event_id, payment_intent, customer_email,
           amount_cents, commission_cents, status, created_at, currency, customer_country,
           commission_pct, items_json, stripe_customer_id, stripe_subscription_id, stripe_invoice_id, kind,
           link_id, user_id, fraud_reason, commission_detail)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7,
                CASE WHEN ?4 IS NOT NULL AND EXISTS (SELECT 1 FROM refunded_payments WHERE payment_intent=?4)
                     THEN 'refunded' ELSE 'pending' END,
                ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?2, 'renewal', ?15, ?16, ?17, ?18)
        ON CONFLICT DO NOTHING`).bind(
        first.affiliate_id, invoice.id, event?.id || null, paymentIntent, invoice.customer_email || null,
        amount, commission, paidAt, currencyCode(invoice.currency),
        typeof country === 'string' && /^[a-z]{2}$/i.test(country) ? country.toUpperCase() : null,
        pct, JSON.stringify(items), customer, subscription,
        first.link_id ?? null, first.user_id ?? null, first.fraud_reason ?? null,
        detail ? JSON.stringify(detail) : null,
    ).run();
    return result.meta?.changes ? { affiliate_id: first.affiliate_id, commission_cents: commission } : null;
}

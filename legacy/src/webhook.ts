// Idempotent conversion recording. Database failures propagate to the webhook
// so it returns non-2xx and Stripe retries instead of losing the commission.

import { currencyCode } from './money.ts';
import { resolvePaidAttribution } from './promotion.ts';
import { stripeId, stripeRequest } from './stripe.ts';
import { selfReferralReason } from './fraud.ts';
import { settleReferral, validUserId } from './referral.ts';
import { invoicePaymentIntent } from './invoice.ts';
import { computeCommission } from './rules.ts';
import type { AffiliateEnv, AffiliatesRow, CheckoutLineItem, CheckoutSession, StripeEvent, StripeObject } from './types.ts';
import { hasDb } from './env.ts';

export async function recordConversion<T extends CheckoutSession>(
    input: T | null | undefined, event: StripeEvent | null | undefined, env: AffiliateEnv,
    lineItems: readonly CheckoutLineItem[] | null = input?.line_items?.data || [],
): Promise<(Omit<T, 'metadata'> & { metadata: Record<string, string> }) | null> {
    if (!input) return null;
    // Stripe payloads are read field by field below.
    let session: StripeObject = input;
    // Resolve before the first insert: idempotent retries preserve the original
    // affiliate and money, so a provisional cookie attribution must never win.
    const candidate = session.metadata?.affiliate_id || session.metadata?.affiliate_attribution_version ||
        session.discounts?.length || session.allow_promotion_codes;
    const recorded = candidate && env.DB ? await env.DB.prepare(
        `SELECT c.affiliate_id, a.code AS affiliate_code FROM conversions c
         LEFT JOIN affiliates a ON a.id=c.affiliate_id WHERE c.stripe_session_id=?1`
    ).bind(session.id).first() : null;
    if (recorded) {
        // Preserve and enrich an already verified purchase even if a code is
        // replaced or an affiliate is suspended before a delayed retry.
        const metadata = { ...session.metadata, affiliate_id: String(recorded.affiliate_id), affiliate_source: 'recorded' };
        delete metadata.affiliate_code;
        if (recorded.affiliate_code) metadata.affiliate_code = recorded.affiliate_code;
        session = { ...session, metadata };
    } else {
        session = await resolvePaidAttribution(session, env);
    }
    if (!session.metadata?.affiliate_id) return null;
    if (!hasDb(env)) throw new Error('Affiliate DB is not configured');
    const affiliateId = session.metadata?.affiliate_id;
    if (!affiliateId) return null;

    const aff = await env.DB.prepare(
        'SELECT id, commission_pct, status, email FROM affiliates WHERE id=?1'
    ).bind(affiliateId).first<Pick<AffiliatesRow, 'id' | 'commission_pct' | 'status' | 'email'>>();
    if (!aff) throw new Error('Attributed affiliate not found');
    if (!recorded && aff.status !== 'active') return null;

    const amountTotal = Number.isFinite(session.amount_total) ? session.amount_total : 0;
    const country = session.customer_details?.address?.country;
    const itemsList = Array.isArray(lineItems) ? lineItems : [];
    const items = itemsList.map(item => {
        const product = item.price?.product;
        return {
            product_id: typeof product === 'string' ? product : product?.id || null,
            name: item.description || product?.name || null,
            variant: item.price?.nickname || null,
            quantity: item.quantity || 1,
        };
    });
    const createdAt = typeof event?.created === 'number' && Number.isFinite(event.created) ? event.created * 1000 : Date.now();
    const currency = currencyCode(session.currency);
    const { commission, pct, detail } = await computeCommission(env, {
        affiliate: aff, amountCents: amountTotal, currency, customerEmail: session.customer_details?.email,
        at: createdAt,
        items: itemsList.map((item, i) => ({
            product_id: items[i].product_id, price_id: stripeId(item.price),
            quantity: items[i].quantity, amount_cents: item.amount_total,
        })),
    });
    const ipRows = (await env.DB.prepare('SELECT ip_hash FROM affiliate_ip_hashes WHERE affiliate_id=?1')
        .bind(affiliateId).all<{ ip_hash: string | null }>()).results || [];
    const fraudReason = selfReferralReason({
        affiliateEmail: aff.email,
        customerEmail: session.customer_details?.email,
        buyerIpHash: session.metadata?.affiliate_buyer_ip_hash,
        affiliateIpHashes: ipRows.map(row => row.ip_hash),
    });
    const linkId = session.metadata?.affiliate_link_id
        ? (await env.DB.prepare('SELECT id FROM links WHERE id=?1 AND affiliate_id=?2')
            .bind(session.metadata.affiliate_link_id, affiliateId).first())?.id || null
        : null;
    const userId = validUserId(session.metadata?.affiliate_user_id) ? session.metadata.affiliate_user_id : null;
    // A subscription Checkout has no payment intent of its own; its first
    // invoice's payment is the one a refund or dispute will name.
    const invoiceId = stripeId(session.invoice);
    const paymentIntent = stripeId(session.payment_intent) ||
        (invoiceId && env.STRIPE_SECRET_KEY ? await invoicePaymentIntent({ id: invoiceId }, env) : null);
    await env.DB.prepare(`
        INSERT INTO conversions
          (affiliate_id, stripe_session_id, stripe_event_id, payment_intent,
           customer_email, amount_cents, commission_cents, status, created_at,
           currency, customer_country, commission_pct, items_json, fraud_reason, link_id, user_id,
           stripe_customer_id, stripe_subscription_id, stripe_invoice_id, commission_detail)
        VALUES (?1,?2,?3,?4,?5,?6,?7,
                CASE WHEN EXISTS (SELECT 1 FROM refunded_payments WHERE payment_intent=?4)
                     THEN 'refunded' ELSE 'pending' END,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)
        ON CONFLICT(stripe_session_id) DO UPDATE SET
          payment_intent=COALESCE(conversions.payment_intent, excluded.payment_intent),
          status=CASE WHEN excluded.status='refunded' AND conversions.status IN ('pending','approved','paying')
                         AND (conversions.payment_intent IS NULL OR conversions.payment_intent=excluded.payment_intent)
                      THEN 'refunded' ELSE conversions.status END,
          currency=COALESCE(conversions.currency, excluded.currency),
          stripe_customer_id=COALESCE(conversions.stripe_customer_id, excluded.stripe_customer_id),
          stripe_subscription_id=COALESCE(conversions.stripe_subscription_id, excluded.stripe_subscription_id),
          stripe_invoice_id=COALESCE(conversions.stripe_invoice_id, excluded.stripe_invoice_id),
          customer_country=COALESCE(conversions.customer_country, excluded.customer_country),
          items_json=CASE WHEN conversions.items_json='[]' THEN excluded.items_json ELSE conversions.items_json END
    `).bind(
        affiliateId,
        session.id,
        event?.id || null,
        paymentIntent,
        session.customer_details?.email || null,
        amountTotal,
        commission,
        createdAt,
        currency,
        typeof country === 'string' && /^[a-z]{2}$/i.test(country) ? country.toUpperCase() : null,
        pct,
        JSON.stringify(items),
        fraudReason,
        linkId,
        userId,
        stripeId(session.customer),
        stripeId(session.subscription),
        invoiceId,
        detail ? JSON.stringify(detail) : null
    ).run();
    if (userId && !recorded) {
        await settleReferral(env, {
            userId, affiliateId: Number(affiliateId), source: session.metadata.affiliate_source,
            stripeCustomerId: stripeId(session.customer),
            at: createdAt,
        });
    }
    return session as Omit<T, 'metadata'> & { metadata: Record<string, string> };
}

// Call after verifying the Stripe signature. Keep a marker even if Checkout
// hasn't arrived, and preserve the history of commissions already paid.
/** Records a verified refund or dispute webhook and returns the number of conversions updated. */
export async function recordRefund(event: StripeEvent | null | undefined, env: AffiliateEnv): Promise<number> {
    if (event?.type !== 'charge.refunded' && event?.type !== 'charge.dispute.created') return 0;
    const object = event.data?.object as StripeObject | undefined;
    let paymentIntent = stripeId(object?.payment_intent ?? object?.charge?.payment_intent);
    if (!paymentIntent && event.type === 'charge.dispute.created' && typeof object?.charge === 'string') {
        const charge = await stripeRequest(env, `charges/${encodeURIComponent(object.charge)}`);
        paymentIntent = stripeId(charge.payment_intent);
    }
    if (!paymentIntent) return 0;
    if (!env.DB) throw new Error('Affiliate DB is not configured');
    const [, updated] = await env.DB.batch([
        env.DB.prepare('INSERT OR IGNORE INTO refunded_payments (payment_intent) VALUES (?1)').bind(paymentIntent),
        env.DB.prepare(`UPDATE conversions SET status='refunded'
            WHERE payment_intent=?1 AND status IN ('pending','approved','paying')`).bind(paymentIntent),
    ]);
    return updated.meta.changes;
}

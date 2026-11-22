// Sales from Stripe's webhook (routes/api/stripe/webhook.ts), after its signature is checked.
//
// Who gets a sale: a partner's promotion code the customer actually paid with, else the partner the
// checkout carried (the user's referral, else the referral cookie: routes/api/host/checkout.ts).
// Idempotent by Checkout Session: a resent event changes nothing, and a sale keeps the partner it
// was first recorded with. A refund or dispute marks its sales refunded, and is remembered even when
// it arrives before the sale.
import { refundedPayments, sales, type SaleItem } from "@schema";
import type Stripe from "stripe";
import { and, db, eq, inArray, sql } from "void/db";
import { computeCommission } from "./commission";
import { selfReferralReason } from "./fraud";
import { activePartner, partnerForPromotion } from "./partners";
import { settleReferral } from "./referrals";
import { hasStripe, idOf, stripe } from "./stripe";

/** The checkout metadata keys this service sets (routes/api/host/checkout.ts) and reads back here. */
export const META = {
  partnerId: "affiliate_partner_id",
  source: "affiliate_source",
  linkId: "affiliate_link_id",
  userId: "affiliate_user_id",
  buyerIpHash: "affiliate_buyer_ip_hash",
} as const;

export type SaleResult = { recorded: true; saleId: string } | { recorded: false; reason: string };

async function lineItems(session: Stripe.Checkout.Session): Promise<Stripe.LineItem[]> {
  // The webhook doesn't carry them. Without a Stripe key (local dev) the sale has no items.
  if (!hasStripe()) return [];
  const list = await stripe().checkout.sessions.listLineItems(session.id, {
    limit: 100,
    expand: ["data.price.product"],
  });
  return list.data;
}

function itemOf(item: Stripe.LineItem): SaleItem {
  const product = item.price?.product;
  const productId =
    typeof product === "string" ? product : product && !product.deleted ? product.id : null;
  const name =
    item.description ??
    (product && typeof product !== "string" && !product.deleted ? product.name : null);
  return { productId, name, variant: item.price?.nickname ?? null, quantity: item.quantity ?? 1 };
}

/** The partner whose promotion code the customer paid with, if any. */
async function promotionPartner(session: Stripe.Checkout.Session) {
  if (!session.total_details?.amount_discount) return null;
  const owners = new Map<string, Awaited<ReturnType<typeof partnerForPromotion>>>();
  for (const discount of session.discounts ?? []) {
    const id = idOf(discount.promotion_code);
    if (!id) continue;
    const partner = await partnerForPromotion(id);
    if (partner) owners.set(partner.id, partner);
  }
  if (owners.size > 1)
    throw new Error(`session ${session.id}: promotion codes of more than one partner`);
  return [...owners.values()][0] ?? null;
}

export async function recordCheckoutSale(
  session: Stripe.Checkout.Session,
  event: Stripe.Event,
): Promise<SaleResult> {
  if (session.payment_status === "unpaid") return { recorded: false, reason: "not paid" };
  const [existing] = await db
    .select({ id: sales.id })
    .from(sales)
    .where(eq(sales.stripeSessionId, session.id))
    .limit(1);
  if (existing) return { recorded: false, reason: "already recorded" };

  const metadata = session.metadata ?? {};
  const byPromotion = await promotionPartner(session);
  const carried = metadata[META.partnerId]
    ? await activePartner(metadata[META.partnerId] ?? "")
    : null;
  const partner = byPromotion ?? carried;
  if (!partner) return { recorded: false, reason: "no partner" };
  const source = byPromotion ? "promo_code" : "checkout";

  const amountCents = session.amount_total ?? 0;
  const currency = (session.currency ?? "usd").toLowerCase();
  const items = (await lineItems(session)).map(itemOf);
  const commission = computeCommission(partner, amountCents);
  const paymentIntent = idOf(session.payment_intent);
  const at = event.created * 1000;
  const customerEmail = session.customer_details?.email ?? null;
  const fraudReason = await selfReferralReason(partner, {
    email: customerEmail,
    ipHash: metadata[META.buyerIpHash] ?? null,
  });
  const linkId = metadata[META.linkId] && carried?.id === partner.id ? metadata[META.linkId] : null;
  const userId = metadata[META.userId] ?? null;

  const refunded = paymentIntent
    ? sql<
        "refunded" | "pending"
      >`CASE WHEN EXISTS (SELECT 1 FROM refunded_payments WHERE payment_intent = ${paymentIntent}) THEN 'refunded' ELSE 'pending' END`
    : "pending";
  const [row] = await db
    .insert(sales)
    .values({
      partnerId: partner.id,
      kind: "checkout",
      status: refunded,
      stripeSessionId: session.id,
      stripeEventId: event.id,
      paymentIntent,
      stripeCustomerId: idOf(session.customer),
      stripeSubscriptionId: idOf(session.subscription),
      stripeInvoiceId: idOf(session.invoice),
      userId,
      linkId,
      customerEmail,
      customerCountry: session.customer_details?.address?.country ?? null,
      amountCents,
      currency,
      commissionCents: commission.commissionCents,
      commissionPct: commission.commissionPct,
      commissionDetail: commission.detail,
      items,
      fraudReason,
      createdAt: at,
    })
    .onConflictDoNothing({ target: sales.stripeSessionId })
    .returning({ id: sales.id });
  if (!row) return { recorded: false, reason: "already recorded" };
  if (userId)
    await settleReferral({
      userId,
      partnerId: partner.id,
      source,
      stripeCustomerId: idOf(session.customer),
      at,
    });
  return { recorded: true, saleId: row.id };
}

/** A refund or dispute: remembered, and its sales not yet paid out marked refunded. */
export async function recordRefund(paymentIntent: string): Promise<number> {
  const [, updated] = await db.batch([
    db.insert(refundedPayments).values({ paymentIntent }).onConflictDoNothing(),
    db
      .update(sales)
      .set({ status: "refunded" })
      .where(
        and(
          eq(sales.paymentIntent, paymentIntent),
          inArray(sales.status, ["pending", "approved", "paying"]),
        ),
      )
      .returning({ id: sales.id }),
  ]);
  return updated.length;
}

/** The payment intent a refund or dispute event is about. */
export async function refundedPaymentIntent(
  event: Stripe.ChargeRefundedEvent | Stripe.ChargeDisputeCreatedEvent,
): Promise<string | null> {
  if (event.type === "charge.refunded") return idOf(event.data.object.payment_intent);
  const dispute = event.data.object;
  const direct = idOf(dispute.payment_intent);
  if (direct) return direct;
  if (typeof dispute.charge === "string" && hasStripe())
    return idOf((await stripe().charges.retrieve(dispute.charge)).payment_intent);
  return idOf(typeof dispute.charge === "string" ? null : dispute.charge.payment_intent);
}

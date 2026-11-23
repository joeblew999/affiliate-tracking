// Sales from Stripe, through the host's Stripe webhook (routes/api/host/stripe-event.ts).
//
// Who gets a sale: a partner's promotion code the customer actually paid with, else the partner the
// checkout carried (the user's referral, else the referral cookie: routes/api/host/checkout.ts).
// Idempotent by Checkout Session: a resent event changes nothing, and a sale keeps the partner it
// was first recorded with. A refund or dispute that arrived before the sale is applied to it as it's
// recorded (src/refunds.ts).
import { sales, type SaleItem } from "@schema";
import type Stripe from "stripe";
import { db, eq } from "void/db";
import { computeCommission, type CommissionItem } from "./commission.ts";
import { selfReferralReason } from "./fraud.ts";
import { activePartner, partnerForPromotion } from "./partners.ts";
import { settleReferral } from "./referrals.ts";
import { applyRefunds } from "./refunds.ts";
import { hasSalesStripe, idOf, invoicePaymentIntent, salesStripe } from "./stripe.ts";

/** The checkout metadata keys this service sets (routes/api/host/checkout.ts) and reads back here. */
export const META = {
  partnerId: "affiliate_partner_id",
  source: "affiliate_source",
  linkId: "affiliate_link_id",
  userId: "affiliate_user_id",
  buyerIpHash: "affiliate_buyer_ip_hash",
} as const;

async function lineItems(session: Stripe.Checkout.Session): Promise<Stripe.LineItem[]> {
  // The webhook doesn't carry them. Without a Stripe key (local dev) the sale has no items.
  if (!hasSalesStripe()) return [];
  const list = await salesStripe().checkout.sessions.listLineItems(session.id, {
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

export async function recordCheckoutSale(session: Stripe.Checkout.Session, event: Stripe.Event) {
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
  const lines = await lineItems(session);
  const items = lines.map(itemOf);
  // A subscription's Checkout has no payment of its own: its first invoice's is the one a refund
  // or dispute will name.
  const paymentIntent =
    idOf(session.payment_intent) ??
    (session.invoice ? await invoicePaymentIntent(session.invoice) : null);
  const at = event.created * 1000;
  // Lowercase: one customer however they typed it (counted in src/stats.ts, capped in src/commission.ts).
  const customerEmail = session.customer_details?.email?.toLowerCase() ?? null;
  // Commission is on the price, not the tax Stripe collected with it (Stripe Tax, or Managed
  // Payments, where Stripe withholds it).
  const commission = await computeCommission(partner, {
    amountCents: amountCents - (session.total_details?.amount_tax ?? 0),
    currency,
    customerEmail,
    at,
    items: lines.map((line, i): CommissionItem => ({
      productId: items[i]?.productId ?? null,
      priceId: line.price?.id ?? null,
      quantity: line.quantity ?? 1,
      amountCents: line.amount_total - line.amount_tax,
    })),
  });
  const fraudReason = await selfReferralReason(partner, {
    email: customerEmail,
    ipHash: metadata[META.buyerIpHash] ?? null,
  });
  const linkId = metadata[META.linkId] && carried?.id === partner.id ? metadata[META.linkId] : null;
  const userId = metadata[META.userId] ?? null;

  const [row] = await db
    .insert(sales)
    .values({
      partnerId: partner.id,
      kind: "checkout",
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
      grossCommissionCents: commission.commissionCents,
      commissionPct: commission.commissionPct,
      commissionDetail: commission.detail,
      items,
      fraudReason,
      createdAt: at,
    })
    .onConflictDoNothing({ target: sales.stripeSessionId })
    .returning({ id: sales.id });
  if (!row) return { recorded: false, reason: "already recorded" };
  if (paymentIntent) await applyRefunds(paymentIntent);
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

/** The payment intent a refund or dispute event is about. */
export async function disputedPaymentIntent(dispute: Stripe.Dispute): Promise<string | null> {
  const direct = idOf(dispute.payment_intent);
  if (direct) return direct;
  if (typeof dispute.charge === "string" && hasSalesStripe())
    return idOf((await salesStripe().charges.retrieve(dispute.charge)).payment_intent);
  return idOf(typeof dispute.charge === "string" ? null : dispute.charge.payment_intent);
}

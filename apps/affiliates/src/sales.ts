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
import { salesWritten } from "./outcomes.ts";
import { activePartner, partnerForPromotion } from "./partners.ts";
import { settleReferral } from "./referrals.ts";
import { ticketTerms } from "./events.ts";
import { applyRefunds } from "./refunds.ts";
import { hasSalesStripe, idOf, invoicePaymentIntent, salesStripe } from "./stripe.ts";

/** The checkout metadata keys this service sets (routes/api/host/checkout.ts) and reads back here. */
export const META = {
  partnerId: "affiliate_partner_id",
  source: "affiliate_source",
  linkId: "affiliate_link_id",
  userId: "affiliate_user_id",
  buyerIpHash: "affiliate_buyer_ip_hash",
  eventId: "affiliate_event_id",
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

/** An id made from a name: the same name, the same id, so recording again changes nothing. */
async function idFrom(name: string): Promise<string> {
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(name)),
  );
  const hex = Array.from(hash.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function recordCheckoutSale(session: Stripe.Checkout.Session, event: Stripe.Event) {
  if (session.payment_status === "unpaid") return { recorded: false, reason: "not paid" };
  const metadata = session.metadata ?? {};
  const amountCents = session.amount_total ?? 0;
  // The price: what was paid less the tax Stripe collected with it (Stripe Tax, or Managed
  // Payments, where Stripe withholds it). Commission and shares are on this.
  const netCents = amountCents - (session.total_details?.amount_tax ?? 0);
  const currency = (session.currency ?? "usd").toLowerCase();
  // A subscription's Checkout has no payment of its own: its first invoice's is the one a refund
  // or dispute will name.
  const paymentIntent =
    idOf(session.payment_intent) ??
    (session.invoice ? await invoicePaymentIntent(session.invoice) : null);
  const at = event.created * 1000;
  // Lowercase: one customer however they typed it (counted in src/stats.ts, capped in src/commission.ts).
  const customerEmail = session.customer_details?.email?.toLowerCase() ?? null;
  const eventId = metadata[META.eventId] ?? null;
  const lines = await lineItems(session);
  const items = lines.map(itemOf);
  const sale = {
    paymentIntent,
    stripeCustomerId: idOf(session.customer),
    userId: metadata[META.userId] ?? null,
    customerEmail,
    customerCountry: session.customer_details?.address?.country ?? null,
    amountCents,
    netCents,
    currency,
    eventId,
    items,
    createdAt: at,
  };

  const organiser = eventId ? await recordOrganiserShare(session, sale, event) : null;
  const affiliate = await recordAffiliateSale(session, sale, event, lines);
  if (paymentIntent) await applyRefunds(paymentIntent);
  // What was recorded, as it now stands, for whoever watches this happen (src/outcomes.ts).
  await salesWritten([organiser, "saleId" in affiliate ? affiliate.saleId : null]);
  return { ...affiliate, organiserShare: organiser };
}

type SaleBase = {
  paymentIntent: string | null;
  stripeCustomerId: string | null;
  userId: string | null;
  customerEmail: string | null;
  customerCountry: string | null;
  amountCents: number;
  netCents: number;
  currency: string;
  eventId: string | null;
  items: SaleItem[];
  createdAt: number;
};

/** The organiser's share of a ticket: their event's organiserPct of the price. Once per checkout. */
async function recordOrganiserShare(
  session: Stripe.Checkout.Session,
  sale: SaleBase,
  event: Stripe.Event,
) {
  const terms = sale.eventId ? await ticketTerms(sale.eventId) : null;
  if (!terms) return null;
  const share = Math.round((sale.netCents * terms.event.organiserPct) / 100);
  const [row] = await db
    .insert(sales)
    .values({
      ...sale,
      id: await idFrom(`organiser:${session.id}`),
      partnerId: terms.organiser.id,
      kind: "organiser",
      stripeEventId: event.id,
      commissionCents: share,
      grossCommissionCents: share,
      commissionPct: terms.event.organiserPct,
    })
    .onConflictDoNothing()
    .returning({ id: sales.id });
  return row?.id ?? null;
}

/** The affiliate's commission, if one brought the buyer. Once per checkout. */
async function recordAffiliateSale(
  session: Stripe.Checkout.Session,
  sale: SaleBase,
  event: Stripe.Event,
  lines: Stripe.LineItem[],
) {
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

  const commission = await computeCommission(partner, {
    amountCents: sale.netCents,
    currency: sale.currency,
    customerEmail: sale.customerEmail,
    at: sale.createdAt,
    items: lines.map((line, i): CommissionItem => ({
      productId: sale.items[i]?.productId ?? null,
      priceId: line.price?.id ?? null,
      quantity: line.quantity ?? 1,
      amountCents: line.amount_total - line.amount_tax,
    })),
  });
  const fraudReason = await selfReferralReason(partner, {
    email: sale.customerEmail,
    ipHash: metadata[META.buyerIpHash] ?? null,
  });
  const linkId = metadata[META.linkId] && carried?.id === partner.id ? metadata[META.linkId] : null;

  const [row] = await db
    .insert(sales)
    .values({
      ...sale,
      partnerId: partner.id,
      kind: "checkout",
      stripeSessionId: session.id,
      stripeEventId: event.id,
      stripeSubscriptionId: idOf(session.subscription),
      stripeInvoiceId: idOf(session.invoice),
      linkId,
      commissionCents: commission.commissionCents,
      grossCommissionCents: commission.commissionCents,
      commissionPct: commission.commissionPct,
      commissionDetail: commission.detail,
      fraudReason,
    })
    .onConflictDoNothing({ target: sales.stripeSessionId })
    .returning({ id: sales.id });
  if (!row) return { recorded: false, reason: "already recorded" };
  if (sale.userId)
    await settleReferral({
      userId: sale.userId,
      partnerId: partner.id,
      source,
      stripeCustomerId: sale.stripeCustomerId,
      at: sale.createdAt,
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

import { links, partners } from "@schema";
import { defineHandler } from "void";
import { and, db, eq } from "void/db";
import { CheckoutInput, type CheckoutOutput } from "../../../src/host-contract.ts";
import { activePartner, type Partner } from "../../../src/partners.ts";
import { parseReferral } from "../../../src/referral-cookie.ts";
import { referringPartner } from "../../../src/referrals.ts";
import { ticketTerms } from "../../../src/events.ts";
import { META } from "../../../src/sales.ts";
import { hashIp } from "../../../src/visitor.ts";

// What the host adds to a Stripe Checkout Session it's about to create: metadata saying which
// partner the sale is for (the user's referral first, else the referral cookie), and that partner's
// buyer discount. A promotion code the customer types that belongs to a partner makes the sale that
// partner's. The webhook (src/sales.ts) checks what was actually paid.
export const POST = defineHandler.withValidator({ body: CheckoutInput })(async (_c, { body }) => {
  const referral = parseReferral(body.ref);
  const fromUser = body.userId ? await referringPartner(body.userId) : null;
  const fromCookie = !fromUser && referral ? await activePartner(referral.partnerId) : null;
  const [typed] = body.promoCode
    ? await db
        .select()
        .from(partners)
        .where(
          and(
            eq(partners.promoCode, body.promoCode.toUpperCase()),
            eq(partners.status, "active"),
            eq(partners.role, "affiliate"),
          ),
        )
        .limit(1)
    : [];
  const partner: Partner | null = typed ?? fromUser ?? fromCookie;

  const metadata: Record<string, string> = {};
  if (body.userId) metadata[META.userId] = body.userId;
  // The event it's for: its organiser's share (src/sales.ts), whoever brought the buyer.
  if (body.eventId && (await ticketTerms(body.eventId))) metadata[META.eventId] = body.eventId;
  if (!partner) return { metadata, promotionCode: null } satisfies CheckoutOutput;
  metadata[META.partnerId] = partner.id;
  metadata[META.source] = typed ? "promo_code" : fromUser ? "referral" : "cookie";
  const ipHash = await hashIp(body.ip);
  if (ipHash) metadata[META.buyerIpHash] = ipHash;
  if (fromCookie && referral?.linkId) {
    const [link] = await db
      .select({ id: links.id })
      .from(links)
      .where(and(eq(links.id, referral.linkId), eq(links.partnerId, partner.id)))
      .limit(1);
    if (link) metadata[META.linkId] = link.id;
  }
  // The partner's buyer discount, made when they were approved: pass as discounts[0].promotion_code.
  return { metadata, promotionCode: partner.promoCodeId } satisfies CheckoutOutput;
});

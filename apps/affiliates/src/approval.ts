// Approving a partner also gives them a buyer discount: a Stripe promotion code for
// AFFILIATES_COUPON_ID named after their code (NICK-1A2B), which checkouts through them carry and
// customers can type. Without a Stripe key or a coupon, partners have no discount.
import { partners } from "@schema";
import { db, eq } from "void/db";
import { env } from "void/env";
import type { Partner } from "./partners";
import { hasStripe, stripe } from "./stripe";

export async function ensurePromotionCode(partner: Partner): Promise<void> {
  if (partner.promoCodeId || !env.AFFILIATES_COUPON_ID || !hasStripe()) return;
  const code = partner.code.toUpperCase();
  const promotion = await stripe().promotionCodes.create(
    {
      promotion: { type: "coupon", coupon: env.AFFILIATES_COUPON_ID },
      code,
      metadata: { partner_id: partner.id },
    },
    { idempotencyKey: `affiliates_promotion_${partner.id}` },
  );
  await db
    .update(partners)
    .set({ promoCode: promotion.code.toUpperCase(), promoCodeId: promotion.id })
    .where(eq(partners.id, partner.id));
}

// A host user tied to the partner who referred them: at sign-up (from the referral cookie), or at
// their first paid sale. Their later purchases are that partner's even after the cookie expires. A
// partner's promotion code can take a user over only before their first paid sale.
import { partners, referrals } from "@schema";
import { and, db, eq, isNull } from "void/db";
import { activePartner, type Partner } from "./partners.ts";
import { parseReferral } from "./referral-cookie.ts";

export async function recordSignupReferral(userId: string, ref: string | null): Promise<boolean> {
  const referral = parseReferral(ref);
  const partner = referral ? await activePartner(referral.partnerId) : null;
  if (!partner || partner.userId === userId) return false;
  const inserted = await db
    .insert(referrals)
    .values({ userId, partnerId: partner.id, source: "signup" })
    .onConflictDoNothing({ target: referrals.userId })
    .returning({ id: referrals.id });
  return inserted.length > 0;
}

/** The partner who referred this user, if still active. */
export async function referringPartner(userId: string): Promise<Partner | null> {
  const [row] = await db
    .select({ partner: partners })
    .from(referrals)
    .innerJoin(partners, eq(partners.id, referrals.partnerId))
    .where(and(eq(referrals.userId, userId), eq(partners.status, "active")))
    .limit(1);
  return row?.partner ?? null;
}

/** After a user's paid sale: who referred them, settled. */
export async function settleReferral(sale: {
  userId: string;
  partnerId: string;
  source: "promo_code" | "checkout";
  stripeCustomerId: string | null;
  at: number;
}): Promise<void> {
  const mine = eq(referrals.userId, sale.userId);
  const notConverted = and(mine, isNull(referrals.convertedAt));
  // One batch, which D1 runs as a unit (Void's Batch Operations), in this order:
  await db.batch([
    // A user with no referral yet: this sale's partner.
    db
      .insert(referrals)
      .values({
        userId: sale.userId,
        partnerId: sale.partnerId,
        source: sale.source,
        createdAt: sale.at,
      })
      .onConflictDoNothing({ target: referrals.userId }),
    // A promo code typed at checkout wins over a referral link, until the referral has converted.
    ...(sale.source === "promo_code"
      ? [
          db
            .update(referrals)
            .set({ partnerId: sale.partnerId, source: "promo_code" })
            .where(notConverted),
        ]
      : []),
    // The customer and when they converted: the first sale's, kept after.
    ...(sale.stripeCustomerId
      ? [
          db
            .update(referrals)
            .set({ stripeCustomerId: sale.stripeCustomerId })
            .where(and(mine, isNull(referrals.stripeCustomerId))),
        ]
      : []),
    db.update(referrals).set({ convertedAt: sale.at }).where(notConverted),
  ]);
}

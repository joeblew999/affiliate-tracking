// A host user tied to the partner who referred them: at sign-up (from the referral cookie), or at
// their first paid sale. Their later purchases are that partner's even after the cookie expires. A
// partner's promotion code can take a user over only before their first paid sale.
import { partners, referrals } from "@schema";
import { and, db, eq, sql } from "void/db";
import { activePartner, type Partner } from "./partners";
import { parseReferral } from "./referral-cookie";

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
  await db
    .insert(referrals)
    .values({
      userId: sale.userId,
      partnerId: sale.partnerId,
      source: sale.source,
      stripeCustomerId: sale.stripeCustomerId,
      createdAt: sale.at,
      convertedAt: sale.at,
    })
    .onConflictDoUpdate({
      target: referrals.userId,
      set: {
        partnerId: sql`CASE WHEN ${referrals.convertedAt} IS NULL AND excluded.source = 'promo_code' THEN excluded.partner_id ELSE ${referrals.partnerId} END`,
        source: sql`CASE WHEN ${referrals.convertedAt} IS NULL AND excluded.source = 'promo_code' THEN 'promo_code' ELSE ${referrals.source} END`,
        stripeCustomerId: sql`COALESCE(${referrals.stripeCustomerId}, excluded.stripe_customer_id)`,
        convertedAt: sql`COALESCE(${referrals.convertedAt}, excluded.converted_at)`,
      },
    });
}

// Looking partners up: by id (the referral cookie, a sale's metadata), by the promotion code a
// customer paid with, and by the host user signed in.
import { partners } from "@schema";
import { and, db, eq } from "void/db";

export type Partner = typeof partners.$inferSelect;

export async function activePartner(id: string): Promise<Partner | null> {
  const [row] = await db
    .select()
    .from(partners)
    .where(and(eq(partners.id, id), eq(partners.status, "active")))
    .limit(1);
  return row ?? null;
}

export async function partnerById(id: string): Promise<Partner | null> {
  const [row] = await db.select().from(partners).where(eq(partners.id, id)).limit(1);
  return row ?? null;
}

export async function partnerForUser(userId: string): Promise<Partner | null> {
  const [row] = await db.select().from(partners).where(eq(partners.userId, userId)).limit(1);
  return row ?? null;
}

/** The active partner who owns this Stripe promotion code (their buyer discount). */
export async function partnerForPromotion(promotionCodeId: string): Promise<Partner | null> {
  const rows = await db
    .select()
    .from(partners)
    .where(and(eq(partners.promoCodeId, promotionCodeId), eq(partners.status, "active")))
    .limit(2);
  if (rows.length > 1)
    throw new Error(`promotion code ${promotionCodeId} belongs to more than one partner`);
  return rows[0] ?? null;
}

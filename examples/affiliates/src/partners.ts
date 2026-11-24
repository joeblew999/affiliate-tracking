// Looking partners up: by id (the referral cookie, a sale's metadata), by the promotion code a
// customer paid with, and by the host user signed in.
import { partners } from "@schema";
import { and, db, eq } from "void/db";

export type Partner = typeof partners.$inferSelect;

/** An active affiliate: only an affiliate is ever credited with bringing a buyer. */
export async function activePartner(id: string): Promise<Partner | null> {
  const [row] = await db
    .select()
    .from(partners)
    .where(and(eq(partners.id, id), eq(partners.status, "active"), eq(partners.role, "affiliate")))
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
    .where(
      and(
        eq(partners.promoCodeId, promotionCodeId),
        eq(partners.status, "active"),
        eq(partners.role, "affiliate"),
      ),
    )
    .limit(2);
  if (rows.length > 1)
    throw new Error(`promotion code ${promotionCodeId} belongs to more than one partner`);
  return rows[0] ?? null;
}

/** Their default link's code, /r/<code>: from their name, made unique. */
export function codeFor(name: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 20) || "partner";
  // 8 hex characters: about 4 billion codes per name, so two partners with one name never clash.
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

import { partners, payouts } from "@schema";
import { defineHandler } from "void";
import { db, desc, eq } from "void/db";
import { requireAdmin } from "@/access";

// The latest 200 payouts, with their partner's name.
export const GET = defineHandler(async (c) => {
  requireAdmin(c);
  const rows = await db
    .select({ payout: payouts, partnerName: partners.name, partnerCode: partners.code })
    .from(payouts)
    .innerJoin(partners, eq(partners.id, payouts.partnerId))
    .orderBy(desc(payouts.createdAt))
    .limit(200);
  return {
    payouts: rows.map(({ payout, partnerName, partnerCode }) => ({
      ...payout,
      partnerName,
      partnerCode,
    })),
  };
});

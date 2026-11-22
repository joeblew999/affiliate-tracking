import { bonus, partners, saleQuery, sales } from "@schema";
import { HTTPException } from "hono/http-exception";
import { defineHandler } from "void";
import { db, desc, eq } from "void/db";
import { env } from "void/env";
import { requireAdmin } from "@/access";
import { activePartner } from "@/partners";

// The latest 200 sales, or one partner's, with their partner's name (admins).
export const GET = defineHandler.withValidator({ query: saleQuery })(async (c, { query }) => {
  requireAdmin(c);
  const rows = await db
    .select({ sale: sales, partnerName: partners.name, partnerCode: partners.code })
    .from(sales)
    .innerJoin(partners, eq(partners.id, sales.partnerId))
    .where(query.partnerId ? eq(sales.partnerId, query.partnerId) : undefined)
    .orderBy(desc(sales.createdAt))
    .limit(200);
  return {
    sales: rows.map(({ sale, partnerName, partnerCode }) => ({
      ...sale,
      partnerName,
      partnerCode,
    })),
  };
});

// An admin's one-off bonus for a partner: a sale of kind "bonus", approved straight away and paid
// with their next payout. In the payout currency: a bonus has no Stripe payment to convert from.
export const POST = defineHandler.withValidator({ body: bonus })(async (c, { body }) => {
  requireAdmin(c);
  if (!(await activePartner(body.partnerId)))
    throw new HTTPException(404, { message: "No such active partner" });
  const currency = env.AFFILIATES_PAYOUT_CURRENCY.toLowerCase();
  const now = Date.now();
  const [row] = await db
    .insert(sales)
    .values({
      partnerId: body.partnerId,
      kind: "bonus",
      status: "approved",
      amountCents: 0,
      currency,
      commissionCents: body.commissionCents,
      grossCommissionCents: body.commissionCents,
      payoutCurrency: currency,
      payoutCents: body.commissionCents,
      bonusNote: body.bonusNote,
      createdAt: now,
      approvedAt: now,
    })
    .returning({ id: sales.id });
  if (!row) throw new Error("bonus not recorded");
  return { id: row.id, currency };
});

import { clicks, sales } from "@schema";
import { defineHandler } from "void";
import { and, count, db, eq, ne, sql, sum } from "void/db";
import { requireUser } from "@/access";
import { partnerForUser } from "@/partners";

// The signed-in user's partner record (any status), with their clicks and sales; null if they
// haven't applied.
export const GET = defineHandler(async (c) => {
  const user = requireUser(c);
  const partner = await partnerForUser(user.id);
  if (!partner) return { partner: null };
  const [clickCount] = await db
    .select({ n: count() })
    .from(clicks)
    .where(eq(clicks.partnerId, partner.id));
  const [saleTotals] = await db
    .select({
      n: sql<number>`COUNT(CASE WHEN ${sales.kind} != 'clawback' THEN 1 END)`,
      commissionCents: sum(sales.commissionCents),
    })
    .from(sales)
    .where(and(eq(sales.partnerId, partner.id), ne(sales.status, "refunded")));
  const { id, code, status, name, commissionPct, promoCode } = partner;
  return {
    partner: {
      id,
      code,
      status,
      name,
      commissionPct,
      promoCode,
      link: new URL(`/r/${code}`, c.req.url).toString(),
      clicks: clickCount?.n ?? 0,
      sales: saleTotals?.n ?? 0,
      commissionCents: Number(saleTotals?.commissionCents ?? 0),
    },
  };
});

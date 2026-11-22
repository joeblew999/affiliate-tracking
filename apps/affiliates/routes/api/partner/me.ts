import { clicks, sales } from "@schema";
import { defineHandler } from "void";
import { and, count, db, eq, ne, sum } from "void/db";
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
  const [saleCount] = await db
    .select({ n: count() })
    .from(sales)
    .where(
      and(
        eq(sales.partnerId, partner.id),
        ne(sales.status, "refunded"),
        ne(sales.kind, "clawback"),
      ),
    );
  const [commission] = await db
    .select({ cents: sum(sales.commissionCents).mapWith(Number) })
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
      sales: saleCount?.n ?? 0,
      commissionCents: commission?.cents ?? 0,
    },
  };
});

import { partnerIdInput, partners, sales } from "@schema";
import { defineHandler } from "void";
import { db, desc, eq } from "void/db";
import { requireAdmin } from "@/access";

// The latest 200 sales, or one partner's, with their partner's name.
export const GET = defineHandler.withValidator({ query: partnerIdInput.partial() })(async (
  c,
  { query },
) => {
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

import { partners, sales } from "@schema";
import { defineHandler } from "void";
import { db, desc, eq } from "void/db";
import { requireAdmin } from "@/access";

// The latest 200 sales, with their partner's name.
export const GET = defineHandler(async (c) => {
  await requireAdmin(c);
  const rows = await db
    .select({ sale: sales, partnerName: partners.name, partnerCode: partners.code })
    .from(sales)
    .innerJoin(partners, eq(partners.id, sales.partnerId))
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

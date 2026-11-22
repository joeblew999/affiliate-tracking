import { commissionRules, partners, payouts, sales } from "@schema";
import { defineHandler, type InferProps } from "void";
import { db, desc, eq } from "void/db";
import { env } from "void/env";
import { stats } from "@/stats";
import { currentUser } from "@/user";

// The admin page: everything, for the host's admins only.
export const loader = defineHandler(async (c) => {
  const user = await currentUser(c);
  const shopUrl = env.HOST_SITE_URL;
  if (user?.role !== "admin") return { allowed: false as const, shopUrl };
  const [partnerRows, saleRows, payoutRows, ruleRows, performance] = await Promise.all([
    db.select().from(partners).orderBy(desc(partners.createdAt)),
    db
      .select({ sale: sales, partnerName: partners.name })
      .from(sales)
      .innerJoin(partners, eq(partners.id, sales.partnerId))
      .orderBy(desc(sales.createdAt))
      .limit(200),
    db
      .select({ payout: payouts, partnerName: partners.name })
      .from(payouts)
      .innerJoin(partners, eq(partners.id, payouts.partnerId))
      .orderBy(desc(payouts.createdAt))
      .limit(200),
    db
      .select()
      .from(commissionRules)
      .orderBy(desc(commissionRules.active), desc(commissionRules.createdAt)),
    stats(null, 30),
  ]);
  return {
    allowed: true as const,
    shopUrl,
    email: user.email,
    payoutCurrency: env.AFFILIATES_PAYOUT_CURRENCY,
    partners: partnerRows,
    sales: saleRows.map(({ sale, partnerName }) => ({ ...sale, partnerName })),
    payouts: payoutRows.map(({ payout, partnerName }) => ({ ...payout, partnerName })),
    rules: ruleRows,
    stats: performance,
  };
});
export type Props = InferProps<typeof loader>;

import { defineHandler } from "void";
import { requirePartner } from "@/access";
import { stats, StatsQuery } from "@/stats";

// The signed-in partner's funnel and click charts, over the last ?days= days (default 30).
export const GET = defineHandler.withValidator({ query: StatsQuery })(async (c, { query }) => {
  const { partner } = await requirePartner(c);
  return stats(partner.id, query.days);
});

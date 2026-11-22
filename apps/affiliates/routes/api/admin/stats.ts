import { defineHandler } from "void";
import { requireAdmin } from "@/access";
import { stats, StatsQuery } from "@/stats";

// Every partner's funnel and the click charts, over the last ?days= days (default 30).
export const GET = defineHandler.withValidator({ query: StatsQuery })(async (c, { query }) => {
  await requireAdmin(c);
  return stats(null, query.days);
});

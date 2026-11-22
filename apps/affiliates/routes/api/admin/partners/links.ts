import { defineHandler } from "void";
import { z } from "zod";
import { requireAdmin } from "@/access";
import { linksOf } from "@/links";

// One partner's short links, as an admin sees them.
export const GET = defineHandler.withValidator({ query: z.object({ partnerId: z.uuid() }) })(async (
  c,
  { query },
) => {
  requireAdmin(c);
  return { links: await linksOf(query.partnerId, new URL(c.req.url).origin) };
});

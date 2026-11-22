import { partnerIdInput } from "@schema";
import { defineHandler } from "void";
import { requireAdmin } from "@/access";
import { linksOf } from "@/links";

// One partner's short links, as an admin sees them.
export const GET = defineHandler.withValidator({ query: partnerIdInput })(async (c, { query }) => {
  requireAdmin(c);
  return { links: await linksOf(query.partnerId, new URL(c.req.url).origin) };
});

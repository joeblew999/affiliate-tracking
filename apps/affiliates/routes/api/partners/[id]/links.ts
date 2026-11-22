import { defineHandler } from "void";
import { requireAdmin } from "@/access";
import { linksOf } from "@/links";

// One partner's short links, as an admin sees them.
export const GET = defineHandler(async (c) => {
  requireAdmin(c);
  return { links: await linksOf(c.req.param("id") ?? "", new URL(c.req.url).origin) };
});

import { linkChange } from "@schema";
import { defineHandler } from "void";
import { requirePartner } from "@/access";
import { archiveLink } from "@/links";

// Archive one of the partner's links: it stops redirecting (it goes to the site's home page).
export const PATCH = defineHandler.withValidator({ body: linkChange })(async (c, { body }) => {
  const { partner } = await requirePartner(c);
  const id = c.req.param("id") ?? "";
  await archiveLink(partner.id, id);
  return { id, status: body.status };
});

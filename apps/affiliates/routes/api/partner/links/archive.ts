import { linkIdInput } from "@schema";
import { defineHandler } from "void";
import { requirePartner } from "@/access";
import { archiveLink } from "@/links";

// Archive one of the partner's links: it stops redirecting (it goes to the site's home page).
export const POST = defineHandler.withValidator({ body: linkIdInput })(async (c, { body }) => {
  const { partner } = await requirePartner(c);
  await archiveLink(partner.id, body.id);
  return { id: body.id, status: "archived" as const };
});

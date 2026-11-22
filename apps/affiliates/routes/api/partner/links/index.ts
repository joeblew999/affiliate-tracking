import { defineHandler } from "void";
import { requirePartner } from "@/access";
import { createLink, linksOf, NewLink } from "@/links";

// The signed-in partner's short links, with their clicks and sales; and making one.
export const GET = defineHandler(async (c) => {
  const { partner } = await requirePartner(c);
  return { links: await linksOf(partner.id, new URL(c.req.url).origin) };
});

export const POST = defineHandler.withValidator({ body: NewLink })(async (c, { body }) => {
  const { partner } = await requirePartner(c);
  const link = await createLink(partner, body);
  return { link: { ...link, url: new URL(`/r/${link.slug}`, c.req.url).toString() } };
});

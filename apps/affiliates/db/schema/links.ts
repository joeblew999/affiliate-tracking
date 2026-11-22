import { createInsertSchema, createSelectSchema } from "void/drizzle-zod";
import { index, sqliteTable, text, uniqueIndex } from "void/schema-d1";
import { z } from "zod";
import { id, now } from "./columns";
import { partners } from "./partners";

/** A partner's short link: /r/<slug> goes to destination, a path on the host's site. */
export const links = sqliteTable(
  "links",
  {
    id: id(),
    partnerId: text()
      .notNull()
      .references(() => partners.id),
    slug: text().notNull(),
    destination: text().notNull(),
    campaign: text(),
    status: text({ enum: ["active", "archived"] })
      .notNull()
      .default("active"),
    createdAt: now(),
  },
  (t) => [
    // Stored lowercase (src/links.ts), so a short name is one link in any case.
    uniqueIndex("links_slug").on(t.slug),
    index("links_partner").on(t.partnerId, t.status),
  ],
);

/** A partner's new short link (POST /api/links). The slug is made from their code when not given. */
export const newLink = createInsertSchema(links, {
  destination: (s) => s.max(512).regex(/^\/(?!\/)[^\s\\]*$/, "a path on the site, like /pricing"),
  campaign: (s) => s.trim().max(100),
  slug: (s) => s.regex(/^[a-z0-9][a-z0-9-]{1,63}$/, "2–64 lowercase letters, digits or dashes"),
})
  .pick({ destination: true, campaign: true, slug: true })
  .partial();

/** Archiving a link (PATCH /api/links/[id]): it stops redirecting. */
export const linkChange = z.object({
  status: createSelectSchema(links).shape.status.extract(["archived"]),
});

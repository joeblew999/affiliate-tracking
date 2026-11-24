import { index, sqliteTable, text } from "void/schema-d1";
import { id, now } from "./columns.ts";
import { partners } from "./partners.ts";
import { links } from "./links.ts";

/** A visit through a partner's link. At most one per visitor IP per partner per day. */
export const clicks = sqliteTable(
  "clicks",
  {
    id: id(),
    partnerId: text()
      .notNull()
      .references(() => partners.id),
    linkId: text().references(() => links.id),
    /** Salted SHA-256 of the IP; the IP itself is never stored. */
    ipHash: text(),
    country: text(),
    device: text({ enum: ["mobile", "tablet", "desktop"] }),
    referrerHost: text(),
    createdAt: now(),
  },
  (t) => [
    index("clicks_partner_ip").on(t.partnerId, t.ipHash, t.createdAt),
    index("clicks_link").on(t.linkId),
    index("clicks_created").on(t.createdAt),
  ],
);

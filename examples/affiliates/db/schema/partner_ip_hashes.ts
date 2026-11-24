import { integer, primaryKey, sqliteTable, text } from "void/schema-d1";
import { partners } from "./partners.ts";

/** The IP hashes a partner used the dashboard from: a sale from one of them is a self-referral. */
export const partnerIpHashes = sqliteTable(
  "partner_ip_hashes",
  {
    partnerId: text()
      .notNull()
      .references(() => partners.id),
    ipHash: text().notNull(),
    lastSeenAt: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.partnerId, t.ipHash] })],
);

import { index, integer, sqliteTable, text } from "void/schema-d1";
import { id, now } from "./columns";
import { partners } from "./partners";

/** A host user who signed up through a partner: their later purchases are the partner's. */
export const referrals = sqliteTable(
  "referrals",
  {
    id: id(),
    userId: text().notNull().unique(),
    partnerId: text()
      .notNull()
      .references(() => partners.id),
    source: text({ enum: ["signup", "promo_code", "checkout"] }).notNull(),
    stripeCustomerId: text(),
    createdAt: now(),
    /** Their first paid sale. */
    convertedAt: integer(),
  },
  (t) => [
    index("referrals_partner").on(t.partnerId, t.createdAt),
    index("referrals_customer").on(t.stripeCustomerId),
  ],
);

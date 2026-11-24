import { createInsertSchema } from "void/drizzle-zod";
import { integer, real, sqliteTable, text } from "void/schema-d1";
import { z } from "zod";
import { id, now } from "./columns.ts";
import { partners } from "./partners.ts";
import { venues } from "./venues.ts";

/**
 * An online event at a venue, run by an organiser. Booking it pays the venue (a sale of kind venue
 * for the venue's payee); once that's paid, it's on sale and the host tells its users. Each ticket
 * pays the organiser organiserPct of the price, not counting tax.
 */
export const events = sqliteTable("events", {
  id: id(),
  /** The event's Stripe product in the selling account: a ticket's line item names it. */
  productId: text().notNull().unique(),
  name: text().notNull(),
  description: text().notNull(),
  venueId: text()
    .notNull()
    .references(() => venues.id),
  organiserId: text()
    .notNull()
    .references(() => partners.id),
  organiserPct: real().notNull(),
  /** A ticket's price, before tax. */
  priceCents: integer().notNull(),
  currency: text().notNull().default("usd"),
  startsAt: integer().notNull(),
  endsAt: integer().notNull(),
  bookedAt: now(),
  /** When the venue's payment went and it went on sale; null until then. */
  onSaleAt: integer(),
});

/** An admin booking an event (the admin page's bookEvent). */
export const eventBooking = createInsertSchema(events, {
  name: (s) => s.trim().min(1).max(200),
  description: (s) => s.trim().min(1).max(2000),
  organiserPct: (s) => s.min(0).max(100),
  priceCents: (s) => s.int().min(100),
})
  .pick({
    name: true,
    description: true,
    venueId: true,
    organiserId: true,
    organiserPct: true,
    priceCents: true,
  })
  .extend({
    /** The start, as the admin's date and time inputs give it (UTC). */
    startsAt: z.iso.datetime({ local: true }),
    hours: z.number().min(0.5).max(24),
  });

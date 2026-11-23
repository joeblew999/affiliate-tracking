import { createInsertSchema } from "void/drizzle-zod";
import { integer, sqliteTable, text } from "void/schema-d1";
import { z } from "zod";
import { id, now } from "./columns.ts";
import { partners } from "./partners.ts";

/** Where an online event is hosted: its price for an event, and how many it holds. */
export const venues = sqliteTable("venues", {
  id: id(),
  name: text().notNull(),
  /** Where it is, as attendees are told: the online platform, and how they get the link. */
  location: text().notNull(),
  /** The attendees it takes to fill it. */
  capacity: integer().notNull(),
  /** What it costs to book for one event, paid when the event is booked. */
  priceCents: integer().notNull(),
  currency: text().notNull().default("usd"),
  /** Who's paid for it: its payee (partners, role venue). */
  payeeId: text()
    .notNull()
    .references(() => partners.id),
  createdAt: now(),
});

/** An admin adding a venue (the admin page's addVenue), paid through its contact, a shop user. */
export const newVenue = createInsertSchema(venues, {
  name: (s) => s.trim().min(1).max(200),
  location: (s) => s.trim().min(1).max(500),
  capacity: (s) => s.int().min(1),
  priceCents: (s) => s.int().min(0),
})
  .pick({ name: true, location: true, capacity: true, priceCents: true })
  .extend({ contactEmail: z.email() });

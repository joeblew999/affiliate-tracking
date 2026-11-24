// The hub's tables: every stream, in its D1 (src/server/d1/schema.ts), read from the nearest read
// replica (void.config.ts, database.readReplication). Better Auth's tables (users, organizations,
// keys) are Void's to generate from auth.ts.
import { integer, primaryKey, sqliteTable, text } from "void/schema-d1";

export * from "../src/server/d1/schema.ts";

/**
 * A delivery by one route (src/push.ts): a subscription of an organization whose events the hub
 * sends, each batch, to a Worker's address, with a secret of the delivery's own.
 */
export const hubPushes = sqliteTable(
  "hub_pushes",
  {
    organization: text("organization").notNull(),
    id: text("id").notNull(),
    url: text("url").notNull(),
    secret: text("secret").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.organization, t.id] })],
);

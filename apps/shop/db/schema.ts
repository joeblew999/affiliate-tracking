// The shop's own tables, beside Better Auth's (Void generates those: .void/better-auth-schema.ts).
import { integer, sqliteTable, text } from "void/schema-d1";

/** Users who asked for no more event emails (the unsubscribe page). */
export const emailOptOuts = sqliteTable("email_opt_outs", {
  userId: text().primaryKey(),
  createdAt: integer().notNull(),
});

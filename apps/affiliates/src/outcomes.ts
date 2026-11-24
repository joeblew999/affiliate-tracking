// What the service's work leaves behind, written to the streams as it's saved, so whoever watches
// an action finish can read its result there and needn't ask the database or a page. Durable State
// (@durable-streams/state): each change says which thing, by type and key, and its value now.
// Written by the code that did the saving, as part of its step (packages/activity's outcome): the
// outcome of an action, not a second copy of the tables kept in step by something else.
import { createStateSchema } from "@durable-streams/state";
import { sales } from "@schema";
import { outcome } from "activity/server";
import { db, inArray } from "void/db";
import { createSelectSchema } from "void/drizzle-zod";

/** The things written, each as its table has it. */
export const outcomes = createStateSchema({
  sales: { schema: createSelectSchema(sales), type: "sale", primaryKey: "id" },
});

/** These sales were just written (new, or changed): each as it's now saved. */
export async function salesWritten(ids: readonly (string | null | undefined)[]) {
  const written = ids.filter((id): id is string => typeof id === "string");
  if (written.length === 0) return;
  const rows = await db.select().from(sales).where(inArray(sales.id, written));
  await outcome(...rows.map((value) => outcomes.sales.upsert({ value })));
}

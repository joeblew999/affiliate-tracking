import { partnerUpdateInput, partners } from "@schema";
import { HTTPException } from "hono/http-exception";
import { defineHandler } from "void";
import { db, eq } from "void/db";
import { requireAdmin } from "@/access";

// A partner's settings: their commission percent, months of renewal commission (null: the
// default), and whether every sale of theirs waits for an admin.
export const POST = defineHandler.withValidator({
  body: partnerUpdateInput,
})(async (c, { body }) => {
  requireAdmin(c);
  const { id, ...changes } = body;
  const [row] = await db.update(partners).set(changes).where(eq(partners.id, id)).returning();
  if (!row) throw new HTTPException(404, { message: "No such partner" });
  return { partner: row };
});

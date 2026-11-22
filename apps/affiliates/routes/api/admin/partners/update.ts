import { partners } from "@schema";
import { HTTPException } from "hono/http-exception";
import { defineHandler } from "void";
import { db, eq } from "void/db";
import { z } from "zod";
import { requireAdmin } from "@/access";

// A partner's settings: their commission percent, months of renewal commission (null: the
// default), and whether every sale of theirs waits for an admin.
export const POST = defineHandler.withValidator({
  body: z.object({
    id: z.uuid(),
    commissionPct: z.number().min(0).max(100).optional(),
    recurringMonths: z.int().min(0).max(1200).nullable().optional(),
    reviewRequired: z.boolean().optional(),
  }),
})(async (c, { body }) => {
  requireAdmin(c);
  const { id, ...changes } = body;
  const [row] = await db.update(partners).set(changes).where(eq(partners.id, id)).returning();
  if (!row) throw new HTTPException(404, { message: "No such partner" });
  return { partner: row };
});

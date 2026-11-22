import { partners } from "@schema";
import { HTTPException } from "hono/http-exception";
import { defineHandler } from "void";
import { db, eq } from "void/db";
import { z } from "zod";
import { requireAdmin } from "@/access";

// Approve (active), suspend or reactivate a partner. Promotion codes and Connect accounts at
// approval come in step 3 of plans/2026-11-22-01-void-service.md.
export const POST = defineHandler.withValidator({
  body: z.object({ id: z.uuid(), status: z.enum(["active", "suspended"]) }),
})(async (c, { body }) => {
  await requireAdmin(c);
  const [row] = await db
    .update(partners)
    .set({ status: body.status })
    .where(eq(partners.id, body.id))
    .returning({ id: partners.id, status: partners.status });
  if (!row) throw new HTTPException(404, { message: "No such partner" });
  return row;
});

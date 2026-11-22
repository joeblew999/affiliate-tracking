import { sales } from "@schema";
import { HTTPException } from "hono/http-exception";
import { defineHandler } from "void";
import { and, db, eq, inArray } from "void/db";
import { z } from "zod";
import { requireAdmin } from "@/access";

// An admin's decision on a sale not yet paid: approve it, reject it (never approved automatically),
// or put it back to pending.
export const POST = defineHandler.withValidator({
  body: z.object({ id: z.uuid(), status: z.enum(["approved", "rejected", "pending"]) }),
})(async (c, { body }) => {
  await requireAdmin(c);
  const [row] = await db
    .update(sales)
    .set({ status: body.status, approvedAt: body.status === "approved" ? Date.now() : null })
    .where(and(eq(sales.id, body.id), inArray(sales.status, ["pending", "approved", "rejected"])))
    .returning({ id: sales.id, status: sales.status });
  if (!row)
    throw new HTTPException(409, {
      message: "Only a pending, approved or rejected sale can be changed",
    });
  return row;
});

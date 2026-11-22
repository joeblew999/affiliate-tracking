import { commissionRules, ruleIdInput } from "@schema";
import { HTTPException } from "hono/http-exception";
import { defineHandler } from "void";
import { db, eq } from "void/db";
import { requireAdmin } from "@/access";

// Stop using a rule. Commission already earned under it stays as it is.
export const POST = defineHandler.withValidator({ body: ruleIdInput })(async (c, { body }) => {
  requireAdmin(c);
  const [row] = await db
    .update(commissionRules)
    .set({ active: false })
    .where(eq(commissionRules.id, body.id))
    .returning({ id: commissionRules.id });
  if (!row) throw new HTTPException(404, { message: "No such rule" });
  return row;
});

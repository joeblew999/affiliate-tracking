import { commissionRuleChange, commissionRules } from "@schema";
import { HTTPException } from "hono/http-exception";
import { defineHandler } from "void";
import { db, eq } from "void/db";
import { requireAdmin } from "@/access";

// Retire a rule. Commission already earned under it stays as it is.
export const PATCH = defineHandler.withValidator({ body: commissionRuleChange })(async (
  c,
  { body },
) => {
  requireAdmin(c);
  const [row] = await db
    .update(commissionRules)
    .set(body)
    .where(eq(commissionRules.id, c.req.param("id") ?? ""))
    .returning({ id: commissionRules.id, active: commissionRules.active });
  if (!row) throw new HTTPException(404, { message: "No such rule" });
  return row;
});

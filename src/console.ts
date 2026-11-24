// The console's own rules: it's for the hub's admins, signed in through its Better Auth (auth.ts).
import { HTTPException } from "hono/http-exception";
import type { CloudContext } from "void";
import { requireAuth } from "void/auth";

/** The signed-in admin, or 401 (nobody signed in) or 403 (not an admin). */
export function requireAdmin(c: CloudContext) {
  const user = requireAuth(c);
  if (user.role !== "admin") throw new HTTPException(403, { message: "For this hub's admins" });
  return user;
}

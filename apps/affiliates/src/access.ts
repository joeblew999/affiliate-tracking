// Who may do what: the signed-in user is this app's Better Auth's (auth.ts). Admins have the admin
// role (from the host); a partner is a user who applied here.
import { HTTPException } from "hono/http-exception";
import type { CloudContext } from "void";
import { requireAuth, type AuthUser } from "void/auth";
import { notePartnerIp } from "./fraud";
import { partnerForUser, type Partner } from "./partners";
import { requestIpHash } from "./visitor";

export function requireAdmin(c: CloudContext): AuthUser {
  const user = requireAuth(c);
  if (user.role !== "admin") throw new HTTPException(403, { message: "Admins only" });
  return user;
}

/** The signed-in user's partner record, active; its IP is remembered for the self-referral check. */
export async function requirePartner(
  c: CloudContext,
): Promise<{ user: AuthUser; partner: Partner }> {
  const user = requireAuth(c);
  const partner = await partnerForUser(user.id);
  if (!partner || partner.status !== "active")
    throw new HTTPException(403, { message: "Not an active partner" });
  await notePartnerIp(partner.id, await requestIpHash(c.req.raw));
  return { user, partner };
}

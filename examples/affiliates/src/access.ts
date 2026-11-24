// Who may do what. Everyone is a shop user (src/user.ts). Admins have the shop's admin role (its
// Better Auth admin plugin); a partner is a shop user who applied here.
import { HTTPException } from "hono/http-exception";
import type { CloudContext } from "void";
import { notePartnerIp } from "./fraud.ts";
import { partnerForUser, type Partner } from "./partners.ts";
import type { User } from "./user.ts";
import { requestIpHash } from "./visitor.ts";

export function requireUser(c: CloudContext): User {
  const user = c.get("shopUser");
  if (!user) throw new HTTPException(401, { message: "Sign in first" });
  return user;
}

/** The signed-in user's partner record, active; its IP is remembered for the self-referral check. */
export async function requirePartner(c: CloudContext): Promise<{ user: User; partner: Partner }> {
  const user = requireUser(c);
  const partner = await partnerForUser(user.id);
  if (!partner || partner.status !== "active")
    throw new HTTPException(403, { message: "Not an active partner" });
  await notePartnerIp(partner.id, await requestIpHash(c.req.raw));
  return { user, partner };
}

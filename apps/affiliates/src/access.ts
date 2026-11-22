// Who may do what. Everyone is a host user (src/user.ts). Admins have the host's admin role (its
// Better Auth admin plugin); a partner is a host user who applied here.
import { HTTPException } from "hono/http-exception";
import type { CloudContext } from "void";
import { notePartnerIp } from "./fraud";
import { partnerForUser, type Partner } from "./partners";
import { currentUser, type HostUser } from "./user";
import { requestIpHash } from "./visitor";

export async function requireUser(c: CloudContext): Promise<HostUser> {
  const user = await currentUser(c);
  if (!user) throw new HTTPException(401, { message: "Sign in first" });
  return user;
}

export async function requireAdmin(c: CloudContext): Promise<HostUser> {
  const user = await requireUser(c);
  if (user.role !== "admin") throw new HTTPException(403, { message: "Admins only" });
  return user;
}

/** The signed-in user's partner record, active; its IP is remembered for the self-referral check. */
export async function requirePartner(
  c: CloudContext,
): Promise<{ user: HostUser; partner: Partner }> {
  const user = await requireUser(c);
  const partner = await partnerForUser(user.id);
  if (!partner || partner.status !== "active")
    throw new HTTPException(403, { message: "Not an active partner" });
  await notePartnerIp(partner.id, await requestIpHash(c.req.raw));
  return { user, partner };
}

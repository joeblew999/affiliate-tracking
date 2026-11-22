// Who is signed in: the host app's Better Auth decides, through the HOST service binding, from the
// session cookie the browser sent. In production the host sets that cookie for the parent domain,
// so this app's subdomain receives it; on localhost cookies are shared across ports. This app
// keeps no users, passwords or sessions of its own.
import type { CloudContext } from "void";
import { env } from "void/env";
import { HOST_TOKEN_HEADER } from "./host-contract";

export interface HostUser {
  id: string;
  email: string;
  name: string;
  /** From the host's Better Auth admin plugin, when it has one. */
  role: string | null;
}

export async function currentUser(c: CloudContext): Promise<HostUser | null> {
  const cookie = c.req.header("cookie");
  if (!cookie) return null;
  const res = await c.env.HOST.fetch(
    new Request("https://host.internal/api/auth/get-session", {
      // The shared secret: every one of these calls comes from this Worker, so the host lets them
      // past Better Auth's per-IP rate limit (apps/shop/auth.ts).
      headers: { cookie, [HOST_TOKEN_HEADER]: env.AFFILIATES_HOST_TOKEN },
    }),
  );
  if (!res.ok) return null;
  const body = (await res.json()) as {
    user?: Partial<HostUser> & { id: string; email: string; name: string };
  } | null;
  const user = body?.user;
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: typeof user.role === "string" ? user.role : null,
  };
}

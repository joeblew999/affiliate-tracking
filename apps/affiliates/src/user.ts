// Who is signed in: the shop's Better Auth decides, through the HOST service binding, as Void's own
// dashboard asks its API (platform/packages/dashboard in the Void repo). The shop sets its session
// cookie for the parent domain (README), so it comes with every request here. This app keeps no
// users, passwords or sessions; middleware/01.user.ts asks once per request.
import type { SessionWithImpersonatedBy, UserWithRole } from "better-auth/plugins/admin";
import type { CloudContext } from "void";
import { env } from "void/env";

export type User = Pick<UserWithRole, "id" | "email" | "name"> & {
  role: string | null;
  /** The admin's user id, while an admin is viewing as this user (the admin plugin's impersonation). */
  impersonatedBy: string | null;
};

/**
 * The request, sent to the shop's Better Auth through the binding: same path, method, body and
 * headers (the session cookie, the page's origin, the visitor's IP for Better Auth's rate limits).
 */
export function toShop(c: CloudContext, request: Request = c.req.raw): Promise<Response> {
  const url = new URL(request.url);
  return c.env.HOST.fetch(
    new Request(new URL(url.pathname + url.search, env.HOST_SITE_URL), request),
  );
}

export async function currentUser(c: CloudContext): Promise<User | null> {
  if (!c.req.header("cookie")) return null;
  const res = await toShop(
    c,
    new Request(new URL("/api/auth/get-session", c.req.url), { headers: c.req.raw.headers }),
  );
  if (!res.ok) return null;
  const body = (await res.json()) as {
    user: UserWithRole;
    session: SessionWithImpersonatedBy;
  } | null;
  if (!body) return null;
  const { id, email, name, role } = body.user;
  return {
    id,
    email,
    name,
    role: role ?? null,
    impersonatedBy: body.session.impersonatedBy ?? null,
  };
}

/** The shop's sign-in page, coming back to this URL after. */
export function signInUrl(returnTo: string): string {
  const url = new URL("/", env.HOST_SITE_URL);
  url.searchParams.set("redirect", returnTo);
  return url.toString();
}

/**
 * A shop user by email, asked of the shop's Better Auth with the signed-in admin's own session (the
 * admin plugin's listUsers): only an admin can look anyone up.
 */
export async function shopUserByEmail(
  c: CloudContext,
  email: string,
): Promise<Pick<UserWithRole, "id" | "email" | "name"> | null> {
  const url = new URL("/api/auth/admin/list-users", c.req.url);
  url.searchParams.set("searchField", "email");
  url.searchParams.set("searchOperator", "contains");
  url.searchParams.set("searchValue", email);
  url.searchParams.set("limit", "10");
  const res = await toShop(c, new Request(url, { headers: c.req.raw.headers }));
  if (!res.ok) throw new Error(`the shop's users: ${res.status} ${await res.text()}`);
  const { users } = (await res.json()) as { users: UserWithRole[] };
  return users.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null;
}

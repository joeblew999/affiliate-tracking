// Who is signed in, once per request (src/user.ts), for routes and pages: c.get("shopUser"). The pages
// need someone: signed out, they go to the shop's sign-in and come back. As Void's own dashboard
// does (its middleware/01.auth.ts).
import { defineMiddleware } from "void";
import { currentUser, signInUrl, type User } from "@/user";

declare module "void" {
  interface CloudContextVariables {
    shopUser: User | null;
  }
}

/** Not about anyone: the shop's Better Auth itself, referral links, and the shop's own calls. */
const PUBLIC_PREFIXES = ["/api/auth/", "/r/", "/api/host/"];
const PAGES = new Set(["/", "/admin"]);

export default defineMiddleware(async (c, next) => {
  const path = c.req.path;
  if (PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    c.set("shopUser", null);
    return next();
  }
  const user = await currentUser(c);
  c.set("shopUser", user);
  if (!user && PAGES.has(path)) return Response.redirect(signInUrl(c.req.url), 302);
  return next();
});

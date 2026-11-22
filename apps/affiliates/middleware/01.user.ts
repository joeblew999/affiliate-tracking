// Who is signed in, once per request (src/user.ts), for routes and pages: c.get("shopUser"), and for
// the layout's header (Void's shared data: useShared() in pages/layout.tsx). The pages need someone:
// signed out, they go to the shop's sign-in and come back. As Void's own dashboard does (its
// middleware/01.auth.ts).
import { defineMiddleware } from "void";
import { env } from "void/env";
import { currentUser, signInUrl, type User } from "@/user";

declare module "void" {
  interface CloudContextVariables {
    shopUser: User | null;
    shared: {
      shopUrl: string;
      user: { email: string; isAdmin: boolean; viewingAs: string | null } | null;
    };
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
  c.set("shared", {
    shopUrl: env.HOST_SITE_URL,
    user: user && {
      email: user.email,
      isAdmin: user.role === "admin",
      // While an admin views as this user: their name, for the bar with the way back.
      viewingAs: user.impersonatedBy ? user.name : null,
    },
  });
  if (!user && PAGES.has(path)) return Response.redirect(signInUrl(c.req.url), 302);
  return next();
});

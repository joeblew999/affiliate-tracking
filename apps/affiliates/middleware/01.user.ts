// Who is signed in, once per request (src/user.ts), for routes and pages: c.get("shopUser"), and for
// the layout's header (Void's shared data: useShared() in pages/layout.tsx). The pages need someone:
// signed out, they go to the shop's sign-in and come back. /admin (its loader and every action) is
// for the shop's admins only: anyone else gets 403, shown by pages/_error.tsx. As Void's own
// dashboard does (its middleware/01.auth.ts).
import { HTTPException } from "hono/http-exception";
import { defineMiddleware } from "void";
import { env } from "void/env";
import { currentUser, signInUrl, type User } from "../src/user.ts";

declare module "void" {
  interface CloudContextVariables {
    shopUser: User | null;
    shared: {
      shopUrl: string;
      /** Where the control plane is (the shop), and whose activity this page shows. */
      controlPlane: string;
      viewer: string | null;
      user: { email: string; isAdmin: boolean; viewingAs: string | null } | null;
    };
  }
}

/**
 * Not about anyone: the shop's Better Auth itself, referral links, the shop's own calls, and the
 * payouts account's Stripe webhook.
 */
const PUBLIC_PREFIXES = ["/api/auth/", "/r/", "/api/host/", "/api/stripe/"];
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
    controlPlane: env.HOST_SITE_URL,
    viewer: user ? (user.role === "admin" ? "admins" : user.id) : null,
    user: user && {
      email: user.email,
      isAdmin: user.role === "admin",
      // While an admin views as this user: their name, for the bar with the way back.
      viewingAs: user.impersonatedBy ? user.name : null,
    },
  });
  if (!user && PAGES.has(path)) return Response.redirect(signInUrl(c.req.url), 302);
  // An admin viewing as someone is that someone here; their way back is the layout's bar.
  if (path === "/admin" && user?.role !== "admin")
    throw new HTTPException(403, { message: "Admins only" });
  return next();
});

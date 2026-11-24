// Who is signed in, once per request (src/user.ts), for routes and pages: c.get("shopUser"), and for
// the layout's header (Void's shared data: useShared() in pages/layout.tsx). The pages need someone:
// signed out, they go to the shop's sign-in and come back. /admin (its loader and every action) is
// for the shop's admins only: anyone else gets 403, shown by pages/_error.tsx. As Void's own
// dashboard does (its middleware/01.auth.ts).
import { HTTPException } from "hono/http-exception";
import { defineMiddleware } from "void";
import { env } from "void/env";
import { hub } from "../src/hub.ts";
import { currentUser, signInUrl, type User } from "../src/user.ts";

declare module "void" {
  interface CloudContextVariables {
    shopUser: User | null;
    shared: {
      shopUrl: string;
      /** Whose activity this page's Activity pane shows, and their latest when the page was made. */
      viewer: string | null;
      activity: { events: unknown[]; offset: string } | null;
      user: { email: string; isAdmin: boolean; viewingAs: string | null } | null;
    };
  }
}

/**
 * Not for this app to say who's asking: the shop's Better Auth itself, referral links, the shop's
 * own calls, the payouts account's Stripe webhook, and the hub's wakes (signed).
 */
const PUBLIC_PREFIXES = ["/api/auth/", "/r/", "/api/host/", "/api/stripe/", "/api/hub/"];
const PAGES = new Set(["/", "/admin"]);

/** A viewer's latest activity, from the hub; none if it can't be reached (the page still shows). */
const recentActivity = (viewer: string) =>
  hub.recent(viewer).catch((error: unknown) => {
    console.error("hub: couldn't read recent activity", error);
    return null;
  });

export default defineMiddleware(async (c, next) => {
  const path = c.req.path;
  if (PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    c.set("shopUser", null);
    return next();
  }
  const user = await currentUser(c);
  c.set("shopUser", user);
  const viewer = user ? (user.role === "admin" ? "admins" : user.id) : null;
  c.set("shared", {
    shopUrl: env.HOST_SITE_URL,
    viewer,
    // Only for a page itself.
    activity:
      viewer && PAGES.has(path) && c.req.method === "GET" ? await recentActivity(viewer) : null,
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

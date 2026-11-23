// Every request that does something is a step in the control plane (packages/activity): of the
// action the affiliate service sent it for, or a new one by whoever is signed in. Also who's
// watching and their latest activity, for the layout's Activity pane (Void's shared data).
import { activityMiddleware } from "activity/server";
import { defineMiddleware } from "void";
import { getUser } from "void/auth";
import "../src/activity.ts";
import { recent } from "../src/streams.ts";

declare module "void" {
  interface CloudContextVariables {
    shared: {
      viewer: string | null;
      /** The viewer's latest activity when the page was made, for the pane to start with. */
      activity: { events: unknown[]; offset: string } | null;
    };
  }
}

const track = activityMiddleware(() => {
  const user = getUser();
  return user ? { id: user.id, name: user.name || user.email } : null;
}, ["/api/affiliates/activity"]);

export default defineMiddleware(async (c, next) => {
  const user = getUser();
  const viewer = user ? (user.role === "admin" ? "admins" : user.id) : null;
  // Only for a page itself, not its later data or anything else asked of the app.
  const page = c.req.method === "GET" && (c.req.header("accept") ?? "").includes("text/html");
  c.set("shared", { viewer, activity: viewer && page ? await recent(viewer) : null });
  return track(c, next);
});

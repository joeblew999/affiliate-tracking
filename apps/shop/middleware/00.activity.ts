// Every request that does something is a step in the control plane (packages/activity): of the
// action the affiliate service sent it for, or a new one by whoever is signed in. Also who's
// watching and their latest activity (from the hub), for the layout's Activity pane (Void's
// shared data).
import { activityMiddleware } from "activity/server";
import { defineMiddleware } from "void";
import { getUser } from "void/auth";
import "../src/activity.ts";
import { followed } from "../src/followed.ts";
import { hub } from "../src/hub.ts";

declare module "void" {
  interface CloudContextVariables {
    shared: {
      viewer: string | null;
      /** The viewer's latest activity when the page was made, for the pane to start with. */
      activity: { events: unknown[]; offset: string } | null;
    };
  }
}

/** A viewer's latest activity, from the hub; none if it can't be reached (the page still shows). */
const recentActivity = (viewer: string) =>
  hub.recent(viewer).catch((error: unknown) => {
    console.error("hub: couldn't read recent activity", error);
    return null;
  });

const track = activityMiddleware(() => {
  const user = getUser();
  return user ? { id: user.id, name: user.name || user.email } : null;
});

export default defineMiddleware(async (c, next) => {
  // The hub is told what the shop follows (src/followed.ts), once in each run of the Worker.
  await followed.following();
  const user = getUser();
  const viewer = user ? (user.role === "admin" ? "admins" : user.id) : null;
  // Only for a page itself, not its later data or anything else asked of the app.
  const page = c.req.method === "GET" && (c.req.header("accept") ?? "").includes("text/html");
  c.set("shared", { viewer, activity: viewer && page ? await recentActivity(viewer) : null });
  return track(c, next);
});

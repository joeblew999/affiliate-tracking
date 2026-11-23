// Every request that does something is a step in the control plane (packages/activity): of the
// action the affiliate service sent it for, or a new one by whoever is signed in. Also who's
// watching, for the layout's Activity pane (Void's shared data).
import { activityMiddleware } from "activity/server";
import { defineMiddleware } from "void";
import { getUser } from "void/auth";
import "../src/activity.ts";

declare module "void" {
  interface CloudContextVariables {
    shared: { controlPlane: string; viewer: string | null };
  }
}

const track = activityMiddleware(() => {
  const user = getUser();
  return user ? { id: user.id, name: user.name || user.email } : null;
}, ["/api/affiliates/activity"]);

export default defineMiddleware(async (c, next) => {
  const user = getUser();
  c.set("shared", {
    controlPlane: new URL(c.req.url).origin,
    viewer: user ? (user.role === "admin" ? "admins" : user.id) : null,
  });
  return track(c, next);
});

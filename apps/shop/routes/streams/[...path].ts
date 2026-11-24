// A page's read of a stream (the Activity pane, packages/activity). The streams are the hub's;
// who is signed in is the shop's to know. So the shop decides (your own stream, or any if you're
// an admin: packages/activity's mayRead) and passes the read on to the hub.
import { mayRead } from "activity";
import { defineHandler } from "void";
import { getUser } from "void/auth";
import { hub } from "../../src/hub.ts";

export const GET = defineHandler((c) => {
  const stream = c.req.param("path") ?? "";
  const user = getUser();
  if (!mayRead(user ? { id: user.id, role: user.role } : null, stream))
    return c.text("Not yours", 403);
  return hub.pass(c.req.raw, stream);
});

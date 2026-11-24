// A page's read of a stream (the Activity pane, examples/activity). The streams are the hub's;
// who is signed in is the shop's to say (middleware/01.user.ts asks it). So this app decides (your
// own stream, or any if you're an admin: examples/activity's mayRead) and passes the read on to
// the hub.
import { mayRead } from "activity";
import { defineHandler } from "void";
import { hub } from "../../src/hub.ts";

export const GET = defineHandler((c) => {
  const stream = c.req.param("path") ?? "";
  if (!mayRead(c.get("shopUser"), stream)) return c.text("Not yours", 403);
  return hub.pass(c.req.raw, stream);
});

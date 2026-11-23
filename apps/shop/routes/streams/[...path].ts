// The shop's streams (src/streams.ts), and who may do what with them:
// - the affiliate service, with the shop's token (through its binding): anything. It reads the
//   streams it follows, and asks for the key its wakes are signed with;
// - a subscriber acknowledging a wake: that request carries the wake's own token, which the
//   subscription checks;
// - a browser: reading your own stream, or any stream if you're an admin (everyone's actions, and
//   a person's own while viewing the program as them). The Activity pane reads here
//   (packages/activity), the affiliate service's pages through that app's route of the same name.
import { defineHandler } from "void";
import { getUser } from "void/auth";
import { env as vars } from "void/env";
import { serve, streamOf } from "../../src/streams.ts";

/** A subscriber's answer to a wake, which its own token allows. */
const ANSWER = /^__ds\/subscriptions\/[^/]+\/(callback|ack|release)$/;

/** Whether two texts are the same, taking the same time whichever character differs. */
function sameText(a: string, b: string) {
  let different = a.length ^ b.length;
  for (let i = 0; i < a.length; i++)
    different |= a.charCodeAt(i) ^ b.charCodeAt(i % (b.length || 1));
  return different === 0;
}

const handle = defineHandler(async (c) => {
  const path = c.req.param("path") ?? "";
  const sent = c.req.header("authorization") ?? "";
  if (sameText(sent, `Bearer ${vars.AFFILIATES_HOST_TOKEN}`)) return serve(c.req.raw);
  if (c.req.method === "POST" && ANSWER.test(path)) return serve(c.req.raw);

  const user = getUser();
  const reading = c.req.method === "GET" || c.req.method === "HEAD";
  const theirs = path === user?.id || user?.role === "admin";
  if (!user || !reading || !theirs || path === "" || path.startsWith("__ds"))
    return c.text("Not yours", 403);
  const found = await serve(c.req.raw);
  if (found.status !== 404 || path.includes("/")) return found;
  // Nothing has happened for them yet: an empty stream, so the page can wait on it.
  await streamOf(path).create();
  return serve(c.req.raw);
});

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;

// The streams' own protocol (Durable Streams, with subscriptions): making, writing, reading and
// following streams, for the organization the caller's key is of (middleware/01.callers.ts).
import { defineHandler } from "void";
import { answerWake, serve } from "../../../src/streams.ts";

const handle = defineHandler((c) => {
  const organization = c.get("organization");
  const path = c.req.param("path") ?? "";
  // No organization: a wake's answer, let through with the wake's own token.
  return organization ? serve(c.req.raw, organization, path) : answerWake(c.req.raw, path);
});

// GET answers HEAD too (Void sends it here).
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;

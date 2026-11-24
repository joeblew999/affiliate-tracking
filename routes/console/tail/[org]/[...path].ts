// A stream of an organization, read by the console (caught up, or live): the protocol's own read,
// for a signed-in admin.
import { defineHandler } from "void";
import { requireAdmin } from "../../../../src/console.ts";
import { serve } from "../../../../src/streams.ts";

export const GET = defineHandler((c) => {
  requireAdmin(c);
  return serve(c.req.raw, c.req.param("org") ?? "", c.req.param("path") ?? "");
});

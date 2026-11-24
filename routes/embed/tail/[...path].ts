// A stream read for an app to show (caught up, or live): the protocol's own read, by the app's key,
// which says whose streams (middleware/01.callers.ts). The app's own route passes its page's
// reads on to here, having decided who may see what.
import { defineHandler } from "void";
import { serve } from "../../../src/streams.ts";

export const GET = defineHandler((c) =>
  serve(c.req.raw, c.get("organization"), c.req.param("path") ?? ""),
);

// An organization's streams at their inside address (src/streams.ts): where a subscriber answers
// a wake (the wake's own token says it may), and where a key of that organization may do anything
// it may at /v1/stream. Who may call: middleware/01.callers.ts.
import { defineHandler } from "void";
import { serve } from "../../../../../src/streams.ts";

const handle = defineHandler((c) =>
  serve(c.req.raw, c.req.param("org") ?? "", c.req.param("path") ?? ""),
);

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;

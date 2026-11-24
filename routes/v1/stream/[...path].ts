// The streams' own protocol (Durable Streams, with subscriptions): making, writing, reading and
// following streams. Who may call: middleware/01.workers.ts.
import { defineHandler } from "void";
import { serve } from "../../../src/streams.ts";

const handle = defineHandler((c) => serve(c.req.raw));

// GET answers HEAD too (Void sends it here).
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const OPTIONS = handle;

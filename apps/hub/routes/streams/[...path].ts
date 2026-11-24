// The streams' own protocol (Durable Streams, with subscriptions): reading, writing, following.
// Who may call: middleware/01.workers.ts.
import { defineHandler } from "void";
import { create, serve } from "../../src/streams.ts";

const handle = defineHandler(async (c) => {
  const found = await serve(c.req.raw);
  const path = c.req.param("path") ?? "";
  // A stream with one name and no folder that nothing has been written to yet: made empty, so a
  // reader can wait on it.
  const waitable = c.req.method === "GET" && path !== "" && !path.includes("/");
  if (found.status !== 404 || !waitable) return found;
  await create(path);
  return serve(c.req.raw);
});

// GET answers HEAD too (Void sends it here).
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;

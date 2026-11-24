// Durable Streams at /v1/stream, every method, with subscriptions (packages/streams), the streams
// themselves in this app's D1 (streams/d1).
import { env } from "cloudflare:workers";
import { defineHandler } from "void";
import { createStreams } from "streams";
import { Directory } from "../../../durable-objects/stream-directory.ts";
import { Signing } from "../../../durable-objects/stream-signing.ts";
import { Subscriptions } from "../../../durable-objects/stream-subscriptions.ts";
import { d1Streams } from "../../../src/d1.ts";

const streams = createStreams({
  root: "/v1/stream",
  streams: d1Streams as (request: Request, env: unknown) => Promise<Response>,
  subscriptions: Subscriptions,
  directory: Directory,
  signing: Signing,
});

const handle = defineHandler((c) => streams.handle(c.req.raw, env as never));

// GET answers HEAD too (Void sends it here).
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const OPTIONS = handle;

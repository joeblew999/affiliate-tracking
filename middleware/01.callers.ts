// Who may call the hub: all of it Better Auth's to say (auth.ts).
// - /api/auth: Better Auth itself (signing in, organizations, keys).
// - /v1/stream: a Worker, by its API key, which names its organization. One exception, which the
//   streams' protocol makes: a subscriber answering a wake carries the wake's own token, which the
//   subscription itself checks. And a browser's CORS preflight carries nothing; the request it's
//   for does.
import { defineMiddleware } from "void";
import { getAuth } from "void/auth";
import { keyFrom } from "../src/caller.ts";

/** A subscriber's answer to a wake. */
const ANSWER = /^\/v1\/stream\/__ds\/subscriptions\/[^/]+\/(callback|ack|release)$/;

export default defineMiddleware(async (c, next) => {
  if (!c.req.path.startsWith("/v1/stream")) return next();
  if (c.req.method === "OPTIONS") return next();
  if (c.req.method === "POST" && ANSWER.test(c.req.path)) return next();
  const key = keyFrom(c.req.raw.headers);
  if (!key) return c.text("An API key is required", 401);
  const checked = await getAuth(c).api.verifyApiKey({ body: { key } });
  if (!checked.valid || !checked.key) {
    const why = checked.error?.message;
    return c.text(typeof why === "string" ? why : "Invalid API key", 401);
  }
  c.set("organization", checked.key.referenceId);
  return next();
});

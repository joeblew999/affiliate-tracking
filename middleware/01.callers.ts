// Who may call the hub: all of it Better Auth's to say (auth.ts).
// - /api/auth: Better Auth itself (signing in, organizations, keys).
// - /v1/stream, /v1/push, and what an app shows of the hub (/embed): a Worker, by its API key,
//   which names its organization.
// - /v1/o/<organization>/stream: the same streams at their inside address. A subscriber answering
//   a wake there carries the wake's own token, which the subscription itself checks (the streams'
//   protocol); anyone else needs a key of that organization.
// - the console's pages and /console: a signed-in admin (their loaders and routes ask).
// A browser's CORS preflight carries nothing; the request it's for does.
import { defineMiddleware } from "void";
import { getAuth } from "void/auth";
import { keyFrom } from "../src/caller.ts";

/** A subscriber's answer to a wake, at an organization's inside address. */
const ANSWER = /^\/v1\/o\/[^/]+\/stream\/__ds\/subscriptions\/[^/]+\/(callback|ack|release)$/;
/** The same at the address a Worker knows: which organization's, the wake's token settles. */
const ANSWER_OUTSIDE = /^\/v1\/stream\/__ds\/subscriptions\/[^/]+\/(callback|ack|release)$/;
const INSIDE = /^\/v1\/o\/([^/]+)\/stream(\/|$)/;
const KEYED = ["/v1/stream", "/v1/o/", "/v1/push", "/embed"];

export default defineMiddleware(async (c, next) => {
  const path = c.req.path;
  if (!KEYED.some((prefix) => path.startsWith(prefix))) return next();
  if (c.req.method === "OPTIONS") return next();
  if (c.req.method === "POST" && ANSWER.test(path)) return next();
  const key = keyFrom(c.req.raw.headers);
  if (!key) return c.text("An API key is required", 401);
  const checked = await getAuth(c).api.verifyApiKey({ body: { key } });
  if (!checked.valid || !checked.key) {
    // Not a key: a wake's token, for the subscription to check (routes/v1/stream).
    if (c.req.method === "POST" && ANSWER_OUTSIDE.test(path)) return next();
    const why = checked.error?.message;
    return c.text(typeof why === "string" ? why : "Invalid API key", 401);
  }
  const organization = checked.key.referenceId;
  const inside = INSIDE.exec(path)?.[1];
  if (inside !== undefined && inside !== organization)
    return c.text("Not this key's organization", 403);
  c.set("organization", organization);
  return next();
});

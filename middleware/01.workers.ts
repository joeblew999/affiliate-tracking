// The hub is for the workers that use it, local or deployed. Each call carries HUB_TOKEN as a bearer
// token (Hono's bearerAuth, which compares it in constant time); anything else gets 401. One
// exception, which the streams' protocol makes: a subscriber answering a wake carries the wake's
// own token, which the subscription itself checks.
import { bearerAuth } from "hono/bearer-auth";
import { defineMiddleware } from "void";
import { env } from "void/env";

/** A subscriber's answer to a wake. */
const ANSWER = /^\/v1\/stream\/__ds\/subscriptions\/[^/]+\/(callback|ack|release)$/;

export default defineMiddleware(async (c, next) => {
  if (c.req.method === "POST" && ANSWER.test(c.req.path)) return next();
  // A browser's CORS preflight carries no token; the request it's for does.
  if (c.req.method === "OPTIONS") return next();
  return bearerAuth({ token: env.HUB_TOKEN })(c, next);
});

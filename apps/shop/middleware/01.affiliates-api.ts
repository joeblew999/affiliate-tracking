// /api/affiliates/* is for the affiliate service only (through its binding). The shop also has a
// public address, so those calls carry the shared AFFILIATES_HOST_TOKEN as a bearer token (Hono's
// bearerAuth, which compares it in constant time), as the service's /api/host/* does.
import { bearerAuth } from "hono/bearer-auth";
import { defineMiddleware } from "void";
import { env } from "void/env";

export default defineMiddleware(async (c, next) => {
  if (!c.req.path.startsWith("/api/affiliates/")) return next();
  return bearerAuth({ token: env.AFFILIATES_HOST_TOKEN })(c, next);
});

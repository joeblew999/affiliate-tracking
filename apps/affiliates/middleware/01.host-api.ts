// /api/host/* is for the host app only (client.ts, through the service binding). The service also
// has a public address, so those calls carry the shared AFFILIATES_HOST_TOKEN as a bearer token
// (Hono's bearerAuth, which compares it in constant time); anything else gets 401.
import { bearerAuth } from "hono/bearer-auth";
import { defineMiddleware } from "void";
import { env } from "void/env";

export default defineMiddleware(async (c, next) => {
  if (!c.req.path.startsWith("/api/host/")) return next();
  return bearerAuth({ token: env.AFFILIATES_HOST_TOKEN })(c, next);
});

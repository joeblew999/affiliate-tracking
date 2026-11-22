// Errors as JSON, { error }, with their status: what the API's callers (the pages, the host app)
// read. HTTPExceptions (src/access.ts) keep their message; anything else is a plain 500.
import { HTTPException } from "hono/http-exception";
import { defineMiddleware } from "void";

export default defineMiddleware(async (c, next) => {
  await next();
  if (c.error instanceof HTTPException) c.res = c.json({ error: c.error.message }, c.error.status);
  else if (c.error && c.req.path.startsWith("/api/"))
    c.res = c.json({ error: "Internal error" }, 500);
});

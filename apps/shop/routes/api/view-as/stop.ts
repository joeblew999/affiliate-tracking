// Back to the admin's own session after viewing as someone (./index.ts), then to the admin page.
import { defineHandler } from "void";
import { getAuth } from "void/auth";
import { env } from "void/env";

export const POST = defineHandler(async (c) => {
  await getAuth(c).api.stopImpersonating({ headers: c.req.raw.headers });
  return c.redirect(new URL("/admin", env.AFFILIATES_SITE_URL), 303);
});

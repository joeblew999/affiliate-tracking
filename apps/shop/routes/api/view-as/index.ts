// An admin views the partner program as another user (Better Auth's admin plugin, impersonation):
// the affiliate service's admin page posts here, from its own origin (trusted in auth.ts). The
// browser's session becomes that user's, for an hour or until "Back to admin" (./stop.ts); then
// it's on to the partner program. Only admins can: Better Auth refuses anyone else.
import { defineHandler } from "void";
import { getAuth } from "void/auth";
import { env } from "void/env";
import { z } from "zod";

const Form = z.object({ userId: z.string().min(1) });

export const POST = defineHandler(async (c) => {
  const { userId } = Form.parse(await c.req.parseBody());
  await getAuth(c).api.impersonateUser({ body: { userId }, headers: c.req.raw.headers });
  return c.redirect(new URL(env.AFFILIATES_SITE_URL), 303);
});

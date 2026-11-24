// A new key for an organization, made by an admin in the console: answered once, in full (the hub
// keeps only its hash).
import { defineHandler } from "void";
import { getAuth } from "void/auth";
import { z } from "zod";
import { requireAdmin } from "../../src/console.ts";

const NewKey = z.object({ organization: z.string().min(1), name: z.string().min(1).max(60) });

export const POST = defineHandler.withValidator({ body: NewKey })(async (c, { body }) => {
  requireAdmin(c);
  const made = await getAuth(c).api.createApiKey({
    body: { name: body.name, organizationId: body.organization },
    headers: c.req.raw.headers,
  });
  return c.json({ key: made.key });
});

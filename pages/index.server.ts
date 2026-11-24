// The hub's console: sign in (its Better Auth, auth.ts), then an organization's streams,
// subscriptions and keys. Each form is a page action calling Better Auth (getAuth(c).api; Void
// sends the cookies it sets). A new key is made by routes/console/keys.ts, which answers with it.
import { APIError } from "better-auth/api";
import { HTTPException } from "hono/http-exception";
import { defineHandler, defineHead, type CloudContext, type InferProps } from "void";
import { getAuth, getUser } from "void/auth";
import { db, sql } from "void/db";
import type { Href } from "void/routes";
import { z } from "zod";
import { requireAdmin } from "../src/console.ts";
import { listStreams, listSubscriptions } from "../src/listing.ts";
import { organizations } from "../src/streams.ts";

type KeyRow = {
  id: string;
  name: string | null;
  start: string | null;
  enabled: number | null;
  createdAt: number;
  lastRequest: number | null;
};

export const loader = defineHandler(async (c) => {
  const user = getUser();
  if (!user || user.role !== "admin") return { user: null };
  const all = await organizations();
  const chosen = all.find((one) => one.slug === c.req.query("org")) ?? all[0] ?? null;
  if (!chosen) return { user: { email: user.email }, organizations: all, organization: null };
  const [streams, subscriptions, keys] = await Promise.all([
    listStreams(chosen.id),
    listSubscriptions(chosen.id),
    db.all<KeyRow>(
      sql`SELECT id, name, start, enabled, createdAt, lastRequest FROM apikey
          WHERE referenceId = ${chosen.id} ORDER BY createdAt DESC`,
    ),
  ]);
  return {
    user: { email: user.email },
    organizations: all,
    organization: {
      ...chosen,
      streams,
      subscriptions,
      keys: keys.map((key) => ({
        id: key.id,
        name: key.name ?? "",
        start: key.start ?? "",
        enabled: key.enabled !== 0,
        createdAt: Number(key.createdAt),
        lastRequest: key.lastRequest === null ? null : Number(key.lastRequest),
      })),
    },
  };
});
export type Props = InferProps<typeof loader>;

export const head = defineHead(() => ({ title: "Durable Streams" }));

/** A Better Auth call, its refusal shown on the form; then on to `to`. */
async function withAuth(c: CloudContext, to: Href, call: (headers: Headers) => Promise<unknown>) {
  try {
    await call(c.req.raw.headers);
  } catch (err) {
    if (err instanceof APIError)
      throw new HTTPException(err.statusCode as 400, { message: err.message });
    throw err;
  }
  return c.redirect(to, 303);
}

const credentials = z.object({ email: z.email(), password: z.string().min(1) });
const slugOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "organization";

export const actions = {
  signIn: defineHandler.withValidator({ body: credentials })((c, { body }) =>
    withAuth(c, "/", (headers) => getAuth(c).api.signInEmail({ body, headers })),
  ),
  // Only the hub's ADMIN_EMAILS can (auth.ts refuses anyone else).
  signUp: defineHandler.withValidator({
    body: credentials.extend({ password: z.string().min(8) }),
  })((c, { body }) =>
    withAuth(c, "/", (headers) =>
      getAuth(c).api.signUpEmail({ body: { ...body, name: body.email }, headers }),
    ),
  ),
  signOut: defineHandler((c) => withAuth(c, "/", (headers) => getAuth(c).api.signOut({ headers }))),
  createOrganization: defineHandler.withValidator({
    body: z.object({ name: z.string().min(1).max(60) }),
  })((c, { body }) => {
    requireAdmin(c);
    const slug = slugOf(body.name);
    return withAuth(c, `/?org=${slug}` as Href, (headers) =>
      getAuth(c).api.createOrganization({ body: { name: body.name, slug }, headers }),
    );
  }),
  // Nothing to do but show the page again (after a key is made).
  refresh: defineHandler((c) => {
    requireAdmin(c);
  }),
  revokeKey: defineHandler.withValidator({ body: z.object({ id: z.string() }) })(
    async (c, { body }) => {
      requireAdmin(c);
      await getAuth(c).api.deleteApiKey({ body: { keyId: body.id }, headers: c.req.raw.headers });
    },
  ),
};

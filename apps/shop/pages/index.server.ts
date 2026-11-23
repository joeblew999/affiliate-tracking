// The shop's page: its events, and sign up, sign in (or as a demo account) and out, as page actions
// calling the shop's Better Auth (getAuth(c).api; Void sends the cookies it sets). Each event's
// own page (events/[id]) sells its tickets.
import { APIError } from "better-auth/api";
import { HTTPException } from "hono/http-exception";
import { defineHandler, defineHead, type CloudContext, type InferProps } from "void";
import { getAuth, getUser } from "void/auth";
import { env } from "void/env";
import type { Href } from "void/routes";
import { z } from "zod";
import { DEMO_PASSWORD } from "affiliates/demo";
import { demoAccounts } from "../src/demo-accounts.ts";
import { events, price, when } from "../src/events.ts";

/** The affiliate service's page at this path or URL; null if it would be anywhere else. */
function service(path: string | null | undefined): Href | null {
  if (!path) return null;
  const url = new URL(path, env.AFFILIATES_SITE_URL);
  return url.origin === new URL(env.AFFILIATES_SITE_URL).origin ? (url.toString() as Href) : null;
}

export const loader = defineHandler((c) => {
  const user = getUser();
  // Sent here to sign in by the affiliate service (its middleware/01.user.ts): back there after.
  const back = service(c.req.query("redirect"));
  if (user && back) return c.redirect(back, 302);
  return {
    back,
    user: user ? { email: user.email, name: user.name, isAdmin: user.role === "admin" } : null,
    affiliatesUrl: env.AFFILIATES_SITE_URL,
    events: events().map(({ id, name, startsAt, endsAt, location, cents }) => ({
      id,
      name,
      when: when({ startsAt, endsAt }),
      location,
      price: price(cents),
    })),
  };
});
export type Props = InferProps<typeof loader>;

export const head = defineHead(() => ({ title: "Account" }));

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

/** `back`: the page's ?redirect=, where to go once signed in. */
const credentials = z.object({
  email: z.email(),
  password: z.string().min(1),
  back: z.string().nullable(),
});

export const actions = {
  signIn: defineHandler.withValidator({ body: credentials })((c, { body: { back, ...body } }) =>
    withAuth(c, service(back) ?? "/", (headers) => getAuth(c).api.signInEmail({ body, headers })),
  ),
  // The new-user hook (auth.ts) reads the referral cookie from these headers.
  signUp: defineHandler.withValidator({
    body: credentials.extend({ password: z.string().min(8), name: z.string() }),
  })((c, { body: { back, ...body } }) =>
    withAuth(c, service(back) ?? "/", (headers) =>
      getAuth(c).api.signUpEmail({ body: { ...body, name: body.name || body.email }, headers }),
    ),
  ),
  demo: defineHandler.withValidator({
    body: z.object({
      email: z
        .string()
        .refine((email) => demoAccounts.some((a) => a.email === email), "not a demo account"),
      back: z.string().nullable(),
    }),
  })((c, { body }) =>
    withAuth(
      c,
      service(body.back) ?? service(demoAccounts.find((a) => a.email === body.email)?.path) ?? "/",
      (headers) =>
        getAuth(c).api.signInEmail({
          body: { email: body.email, password: DEMO_PASSWORD },
          headers,
        }),
    ),
  ),
  signOut: defineHandler((c) => withAuth(c, "/", (headers) => getAuth(c).api.signOut({ headers }))),
};

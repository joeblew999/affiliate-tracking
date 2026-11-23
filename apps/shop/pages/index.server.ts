// The shop's page: sign up, sign in (or as a demo account) and out, and subscribe to Pro, as page
// actions calling the shop's Better Auth (getAuth(c).api; Void sends the cookies it sets). Pro is
// the Stripe plugin's (auth.ts): its checkout and its subscription.
import { APIError } from "better-auth/api";
import { HTTPException } from "hono/http-exception";
import { defineHandler, defineHead, type CloudContext, type InferProps } from "void";
import { getAuth, getUser } from "void/auth";
import { env } from "void/env";
import type { Href } from "void/routes";
import { z } from "zod";
import { DEMO_PASSWORD } from "affiliates/demo";
import { demoAccounts } from "../src/demo-accounts.ts";

/** The affiliate service's page at this path or URL; null if it would be anywhere else. */
function service(path: string | null | undefined): Href | null {
  if (!path) return null;
  const url = new URL(path, env.AFFILIATES_SITE_URL);
  return url.origin === new URL(env.AFFILIATES_SITE_URL).origin ? (url.toString() as Href) : null;
}

/** Whether the shop takes payments: a Stripe key and Pro's price. */
const payments = () => Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_PRO_PRICE_ID);

export const loader = defineHandler(async (c) => {
  const user = getUser();
  // Sent here to sign in by the affiliate service (its middleware/01.user.ts): back there after.
  const back = service(c.req.query("redirect"));
  if (user && back) return c.redirect(back, 302);
  const pro =
    user && payments()
      ? (await getAuth(c).api.listActiveSubscriptions({ headers: c.req.raw.headers })).find(
          (s) => s.plan === "pro",
        )
      : undefined;
  return {
    back,
    user: user ? { email: user.email, name: user.name, isAdmin: user.role === "admin" } : null,
    affiliatesUrl: env.AFFILIATES_SITE_URL,
    payments: payments(),
    pro: pro
      ? {
          status: pro.status,
          periodEnd: pro.periodEnd ? new Date(pro.periodEnd).getTime() : null,
          ending: Boolean(pro.cancelAtPeriodEnd || pro.cancelAt),
        }
      : null,
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

/** A Better Auth call that answers with a Stripe page (Checkout): on to it. */
async function toStripe(
  c: CloudContext,
  call: (headers: Headers) => Promise<{ url?: string | null }>,
) {
  try {
    const { url } = await call(c.req.raw.headers);
    if (!url) throw new HTTPException(502, { message: "Stripe gave no page to go to" });
    return c.redirect(url as Href, 303);
  } catch (err) {
    if (err instanceof APIError)
      throw new HTTPException(err.statusCode as 400, { message: err.message });
    throw err;
  }
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
  // Pro on Stripe's Checkout; the partner the buyer came through goes with it (auth.ts).
  subscribe: defineHandler((c) => {
    const here = new URL("/", c.req.url).toString();
    return toStripe(c, (headers) =>
      getAuth(c).api.upgradeSubscription({
        headers,
        body: { plan: "pro", successUrl: here, cancelUrl: here, disableRedirect: true },
      }),
    );
  }),
};

// The shop's sign-in: Void's Better Auth, with
// - the admin plugin: emails in ADMIN_EMAILS are admins, who run the affiliate program;
// - its session cookie for the parent domain (AUTH_COOKIE_DOMAIN), so the affiliate service on a
//   subdomain receives it and asks this Better Auth who's signed in, through its binding;
// - the Stripe plugin: each user's Stripe customer (made at sign-up), and Stripe's webhook, every
//   event of which goes on to the affiliate service (onEvent). Tickets are one-off payments, which
//   the plugin doesn't make: the event page makes their checkout (pages/events/[id].server.ts);
// - a new-user hook publishing each new user (src/published.ts), which the affiliate service follows.
//
// `void prepare` runs this file in plain Node, with no Worker env, to build the auth schema. So the
// plugins don't depend on the env (the Stripe plugin adds tables, and the schema must be the same
// with or without a key), and values are read from the config's `env` or inside the hooks.
import { stripe } from "@better-auth/stripe";
import { admin } from "better-auth/plugins";
import { defineAuth } from "void/auth";
import { referralFrom, SIGNUPS_STREAM, STRIPE_STREAM } from "affiliates/client";
import { stripeClient } from "./src/stripe.ts";

const text = (value: unknown) => (typeof value === "string" ? value : "");

export default defineAuth(({ defaults, env }) => {
  const admins = new Set(
    text(env.ADMIN_EMAILS)
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
  const cookieDomain = text(env.AUTH_COOKIE_DOMAIN);
  return {
    ...defaults,
    // The affiliate service's pages call this Better Auth on their own origin (its /api/auth).
    trustedOrigins: [
      ...(Array.isArray(defaults.trustedOrigins) ? defaults.trustedOrigins : []),
      text(env.AFFILIATES_SITE_URL) || "http://localhost:5174",
    ],
    // Unset locally: localhost shares cookies across ports.
    ...(cookieDomain
      ? {
          advanced: {
            ...defaults.advanced,
            crossSubDomainCookies: { enabled: true, domain: cookieDomain },
          },
        }
      : {}),
    plugins: [
      admin(),
      stripe({
        stripeClient: stripeClient(text(env.STRIPE_SECRET_KEY)),
        stripeWebhookSecret: text(env.STRIPE_WEBHOOK_SECRET),
        createCustomerOnSignUp: Boolean(text(env.STRIPE_SECRET_KEY)),
        // Sales, renewals, refunds and disputes are the affiliate service's to count: each event
        // is published (src/published.ts, through its queue, so Stripe has its answer at once),
        // and the service follows them.
        // (Worker code, imported when it runs: Void's prepare reads this file outside the Worker.)
        onEvent: async (event) => {
          const { publish } = await import("./src/published.ts");
          await publish({ stream: STRIPE_STREAM, type: "stripe-event", data: event });
        },
      }),
    ],
    databaseHooks: {
      user: {
        create: {
          before: async (user) => ({
            data: { ...user, role: admins.has(user.email.toLowerCase()) ? "admin" : "user" },
          }),
          // Publish it (src/published.ts): the affiliate service follows new users. A sign-up never
          // waits on that or fails because of it.
          after: async (user, ctx) => {
            const { publish } = await import("./src/published.ts");
            await publish({
              stream: SIGNUPS_STREAM,
              type: "signed-up",
              data: { userId: user.id, ref: referralFrom(ctx?.headers?.get("cookie")) },
            });
          },
        },
      },
    },
  };
});

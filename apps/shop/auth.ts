// The shop's sign-in: Void's Better Auth, with
// - the admin plugin: emails in ADMIN_EMAILS are admins, who run the affiliate program;
// - the Stripe plugin: the "pro" subscription, its checkout carrying the affiliate service's
//   attribution and the partner's buyer discount;
// - a new-user hook telling the affiliate service, through a queue (queues/affiliate-signups.ts).
// The affiliate service keeps no users: it asks this app who a session cookie belongs to.
//
// `void prepare` runs this file in plain Node, with no Worker env, to build the auth schema. So the
// plugins don't depend on the env (the Stripe plugin adds tables, and the schema must be the same
// with or without a key), and values are read from the config's `env` or inside the hooks.
import { stripe } from "@better-auth/stripe";
import { admin } from "better-auth/plugins";
import Stripe from "stripe";
import { defineAuth } from "void/auth";
import { queues } from "void/queues";
import { HOST_TOKEN_HEADER, referralFrom } from "affiliates/client";

const text = (value: unknown) => (typeof value === "string" ? value : "");

/** Stripe with the shop's key; without one, every Stripe call fails saying so. */
function stripeClient(key: string): Stripe {
  const httpClient = Stripe.createFetchHttpClient();
  if (key) return new Stripe(key, { httpClient });
  return new Stripe("", {
    httpClient,
    authenticator: async () => {
      throw new Error("STRIPE_SECRET_KEY isn't set: the shop has no payments");
    },
  });
}

export default defineAuth(({ defaults, env }) => {
  const admins = new Set(
    text(env.ADMIN_EMAILS)
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
  const hostToken = text(env.AFFILIATES_HOST_TOKEN);
  const cookieDomain = text(env.AUTH_COOKIE_DOMAIN);
  const affiliatesOrigin = new URL(text(env.AFFILIATES_SITE_URL) || "http://localhost:5174").origin;
  return {
    ...defaults,
    // The affiliate service's pages post to this app (routes/api/view-as/): trust their origin.
    trustedOrigins: [
      ...(Array.isArray(defaults.trustedOrigins) ? defaults.trustedOrigins : []),
      affiliatesOrigin,
    ],
    // The session cookie for the parent domain, so the affiliate service receives it (README).
    ...(cookieDomain
      ? {
          advanced: {
            ...defaults.advanced,
            crossSubDomainCookies: { enabled: true, domain: cookieDomain },
          },
        }
      : {}),
    // The affiliate service asks who is signed in on every request it serves, always from its own
    // Worker, so per-IP limits would make all its users share one. Its calls to get-session carry
    // the shared AFFILIATES_HOST_TOKEN and skip the limit; everything else keeps it (Void's
    // guide/auth.md, "Rate limits").
    rateLimit: {
      ...defaults.rateLimit,
      customRules: {
        ...defaults.rateLimit?.customRules,
        "/get-session": (request, rule) =>
          hostToken && request.headers.get(HOST_TOKEN_HEADER) === hostToken ? false : rule,
      },
    },
    plugins: [
      admin(),
      stripe({
        stripeClient: stripeClient(text(env.STRIPE_SECRET_KEY)),
        stripeWebhookSecret: text(env.STRIPE_WEBHOOK_SECRET),
        createCustomerOnSignUp: Boolean(text(env.STRIPE_SECRET_KEY)),
        subscription: {
          enabled: true,
          plans: [{ name: "pro", priceId: text(env.STRIPE_PRO_PRICE_ID) }],
          // Ask the affiliate service which partner this sale is for, and add their buyer discount.
          getCheckoutSessionParams: async ({ user }, request) => {
            const headers = request?.headers;
            // Loaded here, inside the Worker: src/affiliates.ts uses "cloudflare:workers".
            const { affiliatesService } = await import("./src/affiliates");
            const attribution = await affiliatesService().checkout({
              userId: user.id,
              ref: referralFrom(headers?.get("cookie")),
              promoCode: null,
              ip: headers?.get("cf-connecting-ip") ?? null,
            });
            return {
              params: {
                metadata: attribution.metadata,
                subscription_data: { metadata: attribution.metadata },
                ...(attribution.promotionCode
                  ? { discounts: [{ promotion_code: attribution.promotionCode }] }
                  : {}),
              },
            };
          },
        },
      }),
    ],
    databaseHooks: {
      user: {
        create: {
          before: async (user) => ({
            data: { ...user, role: admins.has(user.email.toLowerCase()) ? "admin" : "user" },
          }),
          // Tell the affiliate service, through a queue: a sign-up never waits on it or fails
          // because of it, and a failed call is retried.
          after: async (user, ctx) => {
            await queues["affiliate-signups"].send({
              userId: user.id,
              ref: referralFrom(ctx?.headers?.get("cookie")),
            });
          },
        },
      },
    },
  };
});

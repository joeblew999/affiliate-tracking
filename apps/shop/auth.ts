// The shop's sign-in: Void's Better Auth, with
// - the admin plugin: emails in ADMIN_EMAILS are admins, who run the affiliate program;
// - the OAuth provider (with the JWT plugin it signs with): the affiliate service signs people in
//   with the shop, as a trusted client that skips the consent screen, and gets their role;
// - the Stripe plugin: the "pro" subscription, its checkout carrying the affiliate service's
//   attribution, and every Stripe event passed on to the service (onEvent);
// - a new-user hook telling the affiliate service, through a queue (queues/affiliate-signups.ts).
//
// `void prepare` runs this file in plain Node, with no Worker env, to build the auth schema. So the
// plugins don't depend on the env (the Stripe plugin adds tables, and the schema must be the same
// with or without a key), and values are read from the config's `env` or inside the hooks.
import { stripe } from "@better-auth/stripe";
import { oauthProvider } from "@better-auth/oauth-provider";
import { admin, jwt } from "better-auth/plugins";
import Stripe from "stripe";
import { defineAuth } from "void/auth";
import { queues } from "void/queues";
import { OAUTH_CLIENT_ID, referralFrom } from "affiliates/client";

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
  return {
    ...defaults,
    // The OAuth provider issues its own tokens at /oauth2/token (Better Auth's setup).
    disabledPaths: ["/token"],
    plugins: [
      admin(),
      jwt({ disableSettingJwtHeader: true }),
      oauthProvider({
        // Sign-in happens on the shop's own page; trusted clients never see a consent page.
        loginPage: "/",
        consentPage: "/",
        // The affiliate service: registered once per database (scripts/setup.ts locally,
        // README "Deploy" in production), trusted, skipping consent.
        cachedTrustedClients: new Set([OAUTH_CLIENT_ID]),
        // Admins here are admins of the affiliate program too.
        customIdTokenClaims: ({ user }) => ({ role: text(user.role) || "user" }),
        customUserInfoClaims: ({ user }) => ({ role: text(user.role) || "user" }),
      }),
      stripe({
        stripeClient: stripeClient(text(env.STRIPE_SECRET_KEY)),
        stripeWebhookSecret: text(env.STRIPE_WEBHOOK_SECRET),
        createCustomerOnSignUp: Boolean(text(env.STRIPE_SECRET_KEY)),
        // Sales, renewals, refunds and disputes are the affiliate service's to count.
        onEvent: async (event) => {
          const { affiliatesService } = await import("./src/affiliates");
          await affiliatesService().stripeEvent(event);
        },
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

// Sign-in: the service's own Better Auth (Void's), where people sign in with the host app. The host
// runs Better Auth's OAuth provider and trusts this service (no consent screen); here generic OAuth
// is the only way in. The admin plugin gives admins their pages and "View as" (impersonating a
// partner).
//
// The host's admins are admins here. Better Auth never takes `role` from a provider's profile (the
// admin plugin marks it input: false), so it comes from the host's ID token instead: Better Auth
// stores that token on the account at every sign-in, and the account hooks below copy its `role`
// claim onto the user.
//
// `void prepare` runs this file in plain Node, with no Worker env, to build the auth schema, so the
// plugins don't depend on the env and values come from the config's `env`.
import type { Account, GenericEndpointContext } from "better-auth";
import { admin, genericOAuth } from "better-auth/plugins";
import { decodeJwt } from "jose";
import { defineAuth } from "void/auth";
import { OAUTH_CLIENT_ID } from "./src/host-contract";

const text = (value: unknown) => (typeof value === "string" ? value : "");

/** Gives the user the role in the host's ID token, which this sign-in just received from the host. */
async function roleFromHost(account: Account, ctx: GenericEndpointContext | null) {
  if (account.providerId !== HOST || !account.idToken || !ctx) return;
  const role = decodeJwt(account.idToken).role === "admin" ? "admin" : "user";
  await ctx.context.internalAdapter.updateUser(account.userId, { role });
}

/** The host's provider id here; sign-in starts with auth.signIn.social({ provider: HOST }). */
export const HOST = "host";

export default defineAuth(({ defaults, env }) => {
  const host = text(env.HOST_SITE_URL) || "http://localhost:5173";
  return {
    ...defaults,
    emailAndPassword: { enabled: false },
    // On localhost both apps share cookies whatever the port: this app's have their own names.
    advanced: { ...defaults.advanced, cookiePrefix: "affiliates" },
    plugins: [
      admin(),
      genericOAuth({
        config: [
          {
            providerId: HOST,
            clientId: OAUTH_CLIENT_ID,
            clientSecret: text(env.AFFILIATES_OAUTH_SECRET),
            discoveryUrl: new URL("/api/auth/.well-known/openid-configuration", host).toString(),
            scopes: ["openid", "profile", "email"],
            pkce: true,
            overrideUserInfo: true,
          },
        ],
      }),
    ],
    databaseHooks: {
      account: { create: { after: roleFromHost }, update: { after: roleFromHost } },
    },
  };
});

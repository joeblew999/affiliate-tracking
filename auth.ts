// Who may call the hub, all of it Better Auth (Void's auth), with its plugins:
// - admin: the people who run this hub. Emails in ADMIN_EMAILS are its admins; nobody else can
//   make an account here (an app's own users are the app's, never the hub's);
// - organization: whose streams are whose. One hub serves one project or many: a project, or a
//   team, is an organization, with its members;
// - API key: how a Worker calls. Each key belongs to an organization, and is made, limited and
//   revoked there. Sent as `Authorization: Bearer <key>` or `x-api-key`.
//
// `void prepare` runs this file in plain Node, with no Worker env, to build the auth schema, so
// the plugins don't depend on the env; values are read from the config's `env` inside the hooks.
import { apiKey } from "@better-auth/api-key";
import { APIError } from "better-auth/api";
import { admin, organization } from "better-auth/plugins";
import { defineAuth } from "void/auth";
import { keyFrom } from "./src/caller.ts";

const text = (value: unknown) => (typeof value === "string" ? value : "");

export default defineAuth(({ defaults, env }) => {
  const admins = () =>
    new Set(
      text(env.ADMIN_EMAILS)
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    );
  return {
    ...defaults,
    plugins: [
      admin(),
      // Only the hub's admins make organizations.
      organization({ allowUserToCreateOrganization: (user) => user.role === "admin" }),
      apiKey({
        references: "organization",
        defaultPrefix: "ds_",
        customAPIKeyGetter: (ctx) => (ctx.headers ? keyFrom(ctx.headers) : null),
        enableMetadata: true,
        // A key has no limit unless one is set on it (the plugin's own default is 10 a day).
        rateLimit: { enabled: false },
      }),
    ],
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (!admins().has(user.email.toLowerCase()))
              throw new APIError("FORBIDDEN", {
                message: "This hub's accounts are for its admins (ADMIN_EMAILS)",
              });
            return { data: { ...user, role: "admin" } };
          },
        },
      },
    },
  };
});

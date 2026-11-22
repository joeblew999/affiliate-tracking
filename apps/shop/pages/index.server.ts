import { defineHandler, defineHead, type InferProps } from "void";
import { getUser } from "void/auth";
import { env } from "void/env";

export const loader = defineHandler((c) => {
  const user = getUser();
  // Sent here to sign in by the affiliate service (its middleware/01.user.ts): back there after.
  // Only to the service, so this can't send anyone elsewhere.
  const asked = c.req.query("redirect");
  const back =
    asked &&
    new URL(asked, env.AFFILIATES_SITE_URL).origin === new URL(env.AFFILIATES_SITE_URL).origin
      ? asked
      : null;
  if (user && back) return Response.redirect(new URL(back, env.AFFILIATES_SITE_URL), 302);
  return {
    back,
    user: user ? { email: user.email, name: user.name, isAdmin: user.role === "admin" } : null,
    affiliatesUrl: env.AFFILIATES_SITE_URL,
  };
});
export type Props = InferProps<typeof loader>;

export const head = defineHead(() => ({ title: "Account" }));

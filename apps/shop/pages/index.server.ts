import { defineHandler, type InferProps } from "void";
import { getUser } from "void/auth";
import { env } from "void/env";

export const loader = defineHandler(() => {
  const user = getUser();
  return {
    user: user ? { email: user.email, name: user.name } : null,
    affiliatesUrl: env.AFFILIATES_SITE_URL,
  };
});
export type Props = InferProps<typeof loader>;

// This app's Better Auth client (void/client's createAuthClient) with the admin plugin's client
// ("View as"). Signing in with the host is Better Auth's social sign-in, with the host's provider id
// from auth.ts (generic OAuth needs no client plugin).
import { adminClient } from "better-auth/client/plugins";
import { createAuthClient } from "void/client";

export const auth = createAuthClient({ basePath: "/api/auth", plugins: [adminClient()] });

/** Sign in with the host app, then come back to this page. */
export function signInWithHost() {
  return auth.signIn.social({ provider: "host", callbackURL: window.location.pathname });
}

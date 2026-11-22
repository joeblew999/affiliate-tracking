// This app's Better Auth client (void/client's createAuthClient) with the admin plugin's client
// ("View as"). Signing in with the host is Better Auth's social sign-in, with the host's provider id
// from auth.ts (generic OAuth needs no client plugin).
import { adminClient } from "better-auth/client/plugins";
import { useEffect } from "react";
import { createAuthClient } from "void/client";

export const auth = createAuthClient({ basePath: "/api/auth", plugins: [adminClient()] });

/** Sign in with the host app, then come back to this page. */
export function signInWithHost() {
  return auth.signIn.social({ provider: "host", callbackURL: window.location.pathname });
}

/**
 * Signs a signed-out visitor in with the host straight away: they come from the host, where they're
 * usually signed in already, and the host trusts this app, so it's a redirect there and back with
 * nothing to press. Not signed in on the host: its sign-in page, then back here.
 */
export function SignInWithHost() {
  useEffect(() => {
    void signInWithHost();
  }, []);
  return <p className="text-muted-foreground p-6 text-sm">Signing you in with the shop…</p>;
}

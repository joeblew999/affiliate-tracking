// The shop's Better Auth client (void/client's createAuthClient), with the OAuth provider's client
// plugin: when the affiliate service sends someone here to sign in, it carries that request through
// the sign-in, and the sign-in's answer says where to go next (back to the service).
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { createAuthClient } from "void/client";

export const auth = createAuthClient({ basePath: "/api/auth", plugins: [oauthProviderClient()] });

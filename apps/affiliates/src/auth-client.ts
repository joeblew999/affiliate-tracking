// Better Auth's client (void/client's createAuthClient) with the admin plugin's client ("View as").
// Its /api/auth is the shop's Better Auth, through this app (routes/api/auth/[...path].ts).
import { adminClient } from "better-auth/client/plugins";
import { createAuthClient } from "void/client";

export const auth = createAuthClient({ basePath: "/api/auth", plugins: [adminClient()] });

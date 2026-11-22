// The shop's Better Auth client (void/client's createAuthClient).
import { createAuthClient } from "void/client";

export const auth = createAuthClient({ basePath: "/api/auth" });

// /api/host/* is for the host app only (client.ts, through the service binding). The service also
// has a public address, so those calls carry the shared AFFILIATES_HOST_TOKEN; anything else gets 401.
import { defineMiddleware } from "void";
import { env } from "void/env";
import { HOST_TOKEN_HEADER } from "@/host-token";

const encoder = new TextEncoder();

// Compares without stopping at the first difference, so timing doesn't reveal the token.
function sameSecret(given: string, expected: string): boolean {
  const a = encoder.encode(given);
  const b = encoder.encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export default defineMiddleware(async (c, next) => {
  if (c.req.path.startsWith("/api/host/")) {
    const given = c.req.header(HOST_TOKEN_HEADER) ?? "";
    if (!sameSecret(given, env.AFFILIATES_HOST_TOKEN))
      return c.json({ error: "unauthorized" }, 401);
  }
  await next();
});

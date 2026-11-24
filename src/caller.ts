// Who a request to the hub is from. A Worker sends a key (Better Auth's API keys, auth.ts), which
// belongs to an organization: whose streams it may touch.

/** A key as a Worker sends it: a bearer token, or the API-key plugin's own header. */
export function keyFrom(headers: Headers): string | null {
  const bearer = headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  return bearer ?? headers.get("x-api-key");
}

declare module "void" {
  interface CloudContextVariables {
    /** The organization the request's key belongs to (middleware/01.callers.ts). */
    organization: string;
  }
}

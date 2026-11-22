// The affiliate service's client for its host app. Calls go through a Cloudflare service binding
// and carry AFFILIATES_HOST_TOKEN; every input and output type comes from the route's own handler
// (the __validators and __output each defineHandler carries), so nothing is written twice.
import type { POST as Signup } from "./routes/api/host/signup";
import { HOST_TOKEN_HEADER, REF_COOKIE } from "./src/host-token";

export { REF_COOKIE };

/** The referral cookie's value from a Cookie header, or null. Pass only this, never the whole header. */
export function referralFrom(cookieHeader: string | null | undefined): string | null {
  for (const part of (cookieHeader ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0 || part.slice(0, eq).trim() !== REF_COOKIE) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim()) || null;
    } catch {
      return null; // not valid percent-encoding: no referral
    }
  }
  return null;
}

type BodyOf<H> = H extends {
  __validators: { body: { "~standard": { types?: { input: infer I } } } };
}
  ? I
  : never;
type OutputOf<H> = H extends { __output: infer O } ? Awaited<O> : never;

export function affiliates(binding: Fetcher, token: string) {
  async function call<H>(path: string, body: BodyOf<H>): Promise<OutputOf<H>> {
    const res = await binding.fetch(new URL(path, "https://affiliates.internal"), {
      method: "POST",
      headers: { "content-type": "application/json", [HOST_TOKEN_HEADER]: token },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`affiliates ${path}: ${res.status} ${await res.text()}`);
    return res.json() as Promise<OutputOf<H>>;
  }
  return {
    /** A user signed up on the host, with the referral cookie's value (referralFrom) or null. */
    signup: (body: BodyOf<typeof Signup>) => call<typeof Signup>("/api/host/signup", body),
  };
}

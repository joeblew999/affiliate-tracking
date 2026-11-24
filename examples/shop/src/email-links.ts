// The unsubscribe link in each event email: the user's id, signed with EMAIL_LINK_SECRET (HMAC
// SHA-256), so only the link that was sent works, and no one has to sign in to use it.
import { env } from "void/env";

async function key(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.EMAIL_LINK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

const base64url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

export async function signature(userId: string): Promise<string> {
  return base64url(await crypto.subtle.sign("HMAC", await key(), new TextEncoder().encode(userId)));
}

/** Whether this is the user's link: Web Crypto's verify, which compares in constant time. */
export async function signedBy(userId: string, sig: string): Promise<boolean> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = Uint8Array.from(atob(sig.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
      c.charCodeAt(0),
    );
  } catch {
    return false;
  }
  return crypto.subtle.verify("HMAC", await key(), bytes, new TextEncoder().encode(userId));
}

/** The unsubscribe page's address for this user. */
export async function unsubscribeUrl(siteUrl: string, userId: string): Promise<string> {
  const url = new URL("/unsubscribe", siteUrl);
  url.searchParams.set("u", userId);
  url.searchParams.set("s", await signature(userId));
  return url.toString();
}

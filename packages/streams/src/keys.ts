// The signing a subscription does (PROTOCOL.md, sections 6.5 and 7.1), with the Workers runtime's
// own crypto:
// - each wake sent to a subscriber is signed with the server's Ed25519 key, whose public half is
//   published for subscribers to check it with;
// - the token a subscriber acknowledges a wake with is signed with a secret of the subscription's
//   own, and says which wake it's for.

const text = new TextEncoder();

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of array) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(value: string): Uint8Array {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export const randomHex = (bytes: number) =>
  [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

export async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", text.encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The public half of the signing key, as published (a JSON Web Key). */
export type PublicJwk = {
  kty: "OKP";
  crv: "Ed25519";
  x: string;
  kid: string;
  use: "sig";
  alg: "EdDSA";
};

/** The server's signing key: made once, kept. `kid` names it, from the key itself. */
export type SigningKey = { private: JsonWebKey; public: PublicJwk };

export async function newSigningKey(): Promise<SigningKey> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const publicJwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  const privateJwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
  const x = publicJwk.x ?? "";
  const thumbprint = await crypto.subtle.digest(
    "SHA-256",
    text.encode(JSON.stringify({ crv: "Ed25519", kty: "OKP", x })),
  );
  return {
    private: privateJwk,
    public: {
      kty: "OKP",
      crv: "Ed25519",
      x,
      kid: `ds_${base64url(thumbprint)}`,
      use: "sig",
      alg: "EdDSA",
    },
  };
}

/** The Webhook-Signature header for a wake's body: `t=<seconds>,kid=<key>,ed25519=<signature>`. */
export async function signWebhook(key: SigningKey, body: string): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000);
  const privateKey = await crypto.subtle.importKey("jwk", key.private, { name: "Ed25519" }, false, [
    "sign",
  ]);
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" },
    privateKey,
    text.encode(`${timestamp}.${body}`),
  );
  return `t=${timestamp},kid=${key.public.kid},ed25519=${base64url(signature)}`;
}

const hmac = (secret: string, usage: "sign" | "verify") =>
  crypto.subtle.importKey("raw", fromBase64url(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    usage,
  ]);

/** A new secret for a subscription's tokens. */
export const newTokenSecret = () => base64url(crypto.getRandomValues(new Uint8Array(32)));

/** How long a token is good for (the reference server's hour). */
const TOKEN_SECONDS = 3600;

/** A token for one wake of a subscription: who it's for, which wake (its generation), until when. */
export async function newToken(secret: string, subject: string, generation: number) {
  const payload = base64url(
    text.encode(
      JSON.stringify({
        sub: subject,
        epoch: generation,
        exp: Math.floor(Date.now() / 1000) + TOKEN_SECONDS,
        jti: randomHex(8),
      }),
    ),
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmac(secret, "sign"),
    text.encode(payload),
  );
  return `${payload}.${base64url(signature)}`;
}

/** The wake a token is for, if it's this subscription's and still good. */
export async function readToken(
  secret: string,
  subject: string,
  token: string,
): Promise<{ generation: number } | { code: "TOKEN_INVALID" | "TOKEN_EXPIRED" }> {
  const [payload, signature, more] = token.split(".");
  if (!payload || !signature || more !== undefined) return { code: "TOKEN_INVALID" };
  try {
    const good = await crypto.subtle.verify(
      "HMAC",
      await hmac(secret, "verify"),
      fromBase64url(signature),
      text.encode(payload),
    );
    if (!good) return { code: "TOKEN_INVALID" };
    const said = JSON.parse(new TextDecoder().decode(fromBase64url(payload))) as {
      sub: string;
      epoch: number;
      exp: number;
    };
    if (said.sub !== subject) return { code: "TOKEN_INVALID" };
    if (Math.floor(Date.now() / 1000) > said.exp) return { code: "TOKEN_EXPIRED" };
    return { generation: said.epoch };
  } catch {
    return { code: "TOKEN_INVALID" };
  }
}

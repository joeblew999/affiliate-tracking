// `vpx scripts/oauth-client.ts [--remote] [--service <url>]`: registers the affiliate service with
// the shop's Better Auth OAuth provider, so people sign in to the service with the shop. It writes
// (or rewrites) the provider's client row in the shop's database with Void's `void db execute`:
// client id "affiliates", the SHA-256 hash of the service's AFFILIATES_OAUTH_SECRET (the provider
// keeps only the hash), the service's callback address, and no consent screen (a trusted client).
//
// Locally (`vp run setup`, `vp run demo`) the secret comes from apps/affiliates/.env and the service
// is http://localhost:5174. For a deployment: AFFILIATES_OAUTH_SECRET in the shell (the value given
// to the service with `void secret put`), `--remote`, and `--service` the service's address.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { OAUTH_CLIENT_ID } from "../apps/affiliates/client";

const args = process.argv.slice(2);
const remote = args.includes("--remote");
const service = args[args.indexOf("--service") + 1] ?? "http://localhost:5174";
if (args.includes("--service") && !args[args.indexOf("--service") + 1])
  throw new Error("--service needs the service's address");

function localSecret(): string | undefined {
  try {
    return readFileSync("apps/affiliates/.env", "utf8").match(
      /^AFFILIATES_OAUTH_SECRET=(.+)$/m,
    )?.[1];
  } catch {
    return undefined;
  }
}
const secret = process.env.AFFILIATES_OAUTH_SECRET ?? (remote ? undefined : localSecret());
if (!secret)
  throw new Error(
    remote
      ? "Set AFFILIATES_OAUTH_SECRET in the shell: the service's value (void secret put)"
      : "apps/affiliates/.env has no AFFILIATES_OAUTH_SECRET: run `vp run setup`",
  );

// As the provider hashes secrets: SHA-256, base64url without padding.
const hash = createHash("sha256").update(secret).digest("base64url");
const callback = new URL("/api/auth/callback/host", service).toString();
const now = Date.now();
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const json = (value: unknown) => quote(JSON.stringify(value));
const columns: Record<string, string> = {
  id: quote(OAUTH_CLIENT_ID),
  clientId: quote(OAUTH_CLIENT_ID),
  clientSecret: quote(hash),
  name: quote("Partner program"),
  disabled: "0",
  skipConsent: "1",
  scopes: json(["openid", "profile", "email"]),
  redirectUris: json([callback]),
  tokenEndpointAuthMethod: quote("client_secret_post"),
  grantTypes: json(["authorization_code", "refresh_token"]),
  responseTypes: json(["code"]),
  requirePKCE: "1",
  createdAt: String(now),
  updatedAt: String(now),
};
const names = Object.keys(columns).map((name) => `"${name}"`);
const sql = `INSERT INTO "oauthClient" (${names.join(", ")}) VALUES (${Object.values(columns).join(", ")})
ON CONFLICT("clientId") DO UPDATE SET ${Object.keys(columns)
  .filter((name) => name !== "id" && name !== "createdAt")
  .map((name) => `"${name}" = excluded."${name}"`)
  .join(", ")};\n`;

mkdirSync(".demo", { recursive: true });
writeFileSync(".demo/oauth-client.sql", sql);
const run = spawnSync(
  "node_modules/.bin/void",
  [
    "db",
    "execute",
    ...(remote ? ["--remote", "--yes"] : []),
    "--file",
    "../../.demo/oauth-client.sql",
  ],
  { cwd: "apps/shop", stdio: "inherit" },
);
if (run.status !== 0) throw new Error("registering the OAuth client failed");
console.log(`oauth client "${OAUTH_CLIENT_ID}" registered, calling back to ${callback}`);

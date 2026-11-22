// `vp run setup`: each app's local .env, once per clone. Both apps get the same random
// AFFILIATES_HOST_TOKEN (the secret the shop's calls to the affiliate service carry). An app whose
// .env already has one keeps it; if only one app has it, the other gets the same value.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const apps = ["apps/affiliates", "apps/shop"];
const KEY = "AFFILIATES_HOST_TOKEN";

function read(app: string): string {
  return existsSync(`${app}/.env`) ? readFileSync(`${app}/.env`, "utf8") : "";
}
function tokenIn(text: string): string | undefined {
  return text.match(new RegExp(`^${KEY}=(.+)$`, "m"))?.[1];
}

const token =
  apps.map((app) => tokenIn(read(app))).find(Boolean) ?? randomBytes(32).toString("hex");
for (const app of apps) {
  const text = read(app);
  const current = tokenIn(text);
  if (current === token) continue;
  const next = current
    ? text.replace(new RegExp(`^${KEY}=.*$`, "m"), `${KEY}=${token}`)
    : `${text}${text && !text.endsWith("\n") ? "\n" : ""}${KEY}=${token}\n`;
  writeFileSync(`${app}/.env`, next);
  console.log(`${app}/.env: ${KEY} ${current ? "updated" : "added"}`);
}

// `vp run setup`: each app's local .env, once per clone and safe to rerun. Values already there are
// kept; missing ones are added. The shared ones are the same wherever they're set:
// AFFILIATES_HOST_TOKEN in the shop and the service. Each of them also needs a key for the hub
// (HUB_KEY), which the hub itself makes: examples/scripts/keys.ts, after the databases are there.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const random = () => randomBytes(32).toString("hex");

function read(app: string): string {
  return existsSync(`${app}/.env`) ? readFileSync(`${app}/.env`, "utf8") : "";
}
function valueIn(text: string, key: string): string | undefined {
  return text.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1];
}

const APPS = [".", "examples/affiliates", "examples/shop"];

/** A value every app that has it must agree on: the one already there, or a new one. */
const sharedValue = (key: string) =>
  APPS.map((app) => valueIn(read(app), key)).find((value) => value !== undefined) ?? random();

const SHARED = {
  AFFILIATES_HOST_TOKEN: sharedValue("AFFILIATES_HOST_TOKEN"),
};
const { AFFILIATES_HOST_TOKEN } = SHARED;
const sharedOf = (key: string): string | undefined => (SHARED as Record<string, string>)[key];

const wanted: Record<string, Record<string, string>> = {
  // The hub's local admin (its Better Auth, auth.ts), who makes its keys (examples/scripts/keys.ts).
  ".": { ADMIN_EMAILS: "admin@example.test", HUB_ADMIN_PASSWORD: random() },
  "examples/affiliates": {
    AFFILIATES_HOST_TOKEN,
    HOST_SITE_URL: "http://localhost:5173",
    AFFILIATES_IP_SALT: random(),
    // Sales wait 30 days before they're approved.
    AFFILIATES_HOLD_DAYS: "30",
  },
  "examples/shop": {
    AFFILIATES_HOST_TOKEN,
    ADMIN_EMAILS: "admin@example.test",
    // A local signing secret for the shop's Stripe webhook (Better Auth's Stripe plugin).
    STRIPE_WEBHOOK_SECRET: `whsec_${random()}`,
    EMAIL_LINK_SECRET: random(),
  },
};

for (const [app, values] of Object.entries(wanted)) {
  let text = read(app);
  const added: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    const current = valueIn(text, key);
    if (current !== undefined && (sharedOf(key) ?? current) === current) continue;
    text =
      current !== undefined
        ? text.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${value}`)
        : `${text}${text && !text.endsWith("\n") ? "\n" : ""}${key}=${value}\n`;
    added.push(key);
  }
  if (added.length) {
    writeFileSync(`${app}/.env`, text);
    console.log(`${app}/.env: ${added.join(", ")}`);
  }
}

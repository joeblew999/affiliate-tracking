// `vp run setup`: each app's local .env, once per clone and safe to rerun. Values already there are
// kept; missing ones are added. The shared AFFILIATES_HOST_TOKEN is the same in both apps.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const random = () => randomBytes(32).toString("hex");

function read(app: string): string {
  return existsSync(`${app}/.env`) ? readFileSync(`${app}/.env`, "utf8") : "";
}
function valueIn(text: string, key: string): string | undefined {
  return text.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1];
}

const shared =
  valueIn(read("apps/affiliates"), "AFFILIATES_HOST_TOKEN") ??
  valueIn(read("apps/shop"), "AFFILIATES_HOST_TOKEN") ??
  random();

const wanted: Record<string, Record<string, string>> = {
  "apps/affiliates": {
    AFFILIATES_HOST_TOKEN: shared,
    HOST_SITE_URL: "http://localhost:5173",
    AFFILIATES_IP_SALT: random(),
    // Sales wait 30 days before they're approved (the tests date events back to check it).
    AFFILIATES_HOLD_DAYS: "30",
  },
  "apps/shop": {
    AFFILIATES_HOST_TOKEN: shared,
    ADMIN_EMAILS: "admin@example.test",
    // A local signing secret for the shop's Stripe webhook (Better Auth's Stripe plugin): the
    // dev-server tests sign their Stripe events with it.
    STRIPE_WEBHOOK_SECRET: `whsec_${random()}`,
  },
};

for (const [app, values] of Object.entries(wanted)) {
  let text = read(app);
  const added: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    const current = valueIn(text, key);
    if (current !== undefined && !(key === "AFFILIATES_HOST_TOKEN" && current !== shared)) continue;
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

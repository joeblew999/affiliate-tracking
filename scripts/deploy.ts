// `vp run deploy`: everything deployed to Cloudflare, with Void: the hub, then the example's
// service, then its shop. An app's production settings, if it has a .env.production (never
// committed), are synced as its secrets first. Needs `void cloudflare login` once per machine.
// `vp run deploy -- .` deploys only the hub; any of scripts/apps.ts's folders can be named.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { APPS } from "./apps.ts";

const VOID = resolve("node_modules/.bin/void");
const chosen = process.argv.slice(2);

function run(app: string, args: string[]) {
  console.log(`\n${app === "." ? "the hub" : app}: void ${args.join(" ")}`);
  if (spawnSync(VOID, args, { cwd: app, stdio: "inherit" }).status !== 0)
    throw new Error(`${app}: void ${args.join(" ")} failed`);
}

for (const app of APPS.filter((one) => chosen.length === 0 || chosen.includes(one))) {
  if (existsSync(join(app, ".env.production"))) run(app, ["secret", "sync", ".env.production"]);
  run(app, ["deploy", "--platform", "cloudflare"]);
}

// `vp run deploy`: everything deployed to Cloudflare, with Void: the hub, then the example's
// service, then its shop. An app's production settings, if it has a production.env (never
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
  // Cloudflare, and the account, saved as where this app deploys (.void/project.json, and the
  // account in void.lock.json): on a first deploy, and again after `vp run destroy`.
  if (!existsSync(join(app, ".void", "project.json")) || !existsSync(join(app, "void.lock.json")))
    run(app, ["connect", "--platform", "cloudflare"]);
  if (existsSync(join(app, "production.env")))
    run(app, ["secret", "sync", "production.env", "--yes"]);
  run(app, ["deploy", "--platform", "cloudflare"]);
}

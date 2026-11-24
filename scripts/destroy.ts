// `vp run destroy`: everything this repo deploys, removed from Cloudflare: each app's Worker (with
// its custom domains and durable objects), its queues and its D1 database, the shop first and the
// hub last. Void never removes a direct Cloudflare deployment itself (its docs: "remove resources
// explicitly with Cloudflare tooling"), so this is Cloudflare's own wrangler, told what Void named
// things (scripts/apps.ts). It only lists what it would remove unless `--yes` is given:
// `vp run destroy -- --yes`. What isn't there is skipped. Everything in the databases is lost.
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { APPS, resourcesOf } from "./apps.ts";

const WRANGLER = resolve("node_modules/.bin/wrangler");
const yes = process.argv.includes("--yes");
const all = APPS.map(resourcesOf).reverse();

console.log(
  yes ? "Removing from Cloudflare:" : "Would remove from Cloudflare (add --yes to do it):",
);
for (const { worker, database, queues } of all)
  console.log(
    `  Worker ${worker}${database ? `, database ${database}` : ""}${queues.length ? `, queues ${queues.join(", ")}` : ""}`,
  );
if (!yes) process.exit(0);

/** Run wrangler; whether it worked. Something already gone is not a failure. */
function wrangler(what: string, args: string[]): void {
  const done = spawnSync(WRANGLER, args, { encoding: "utf8" });
  const said = `${done.stdout}${done.stderr}`;
  const gone =
    /not found|does not exist|doesn't exist|could not find|couldn't find|10007|10090|7404/i.test(
      said,
    );
  console.log(`  ${done.status === 0 ? "removed" : gone ? "not there" : "FAILED"}: ${what}`);
  if (done.status !== 0 && !gone) {
    console.error(said.trim());
    process.exitCode = 1;
  }
}

for (const { app, worker, database, queues } of all) {
  // A Worker can't go while it consumes a queue, nor a queue while it has a consumer.
  for (const queue of queues)
    spawnSync(WRANGLER, ["queues", "consumer", "remove", queue, worker], { encoding: "utf8" });
  wrangler(`Worker ${worker}`, ["delete", "--name", worker, "--force"]);
  for (const queue of queues) wrangler(`queue ${queue}`, ["queues", "delete", queue]);
  if (database) wrangler(`database ${database}`, ["d1", "delete", database, "-y"]);
  // Void's record of what was deployed: about resources that are gone now.
  const lock = join(app, "void.lock.json");
  if (app !== "." && existsSync(lock)) rmSync(lock);
}

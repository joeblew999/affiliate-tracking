// The repo's deployable apps, in the order they're deployed: the hub first (the others bind to
// it), then the example's service, then its shop (which binds to both). Removed in reverse.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

export const APPS = [".", "examples/affiliates", "examples/shop"];

/**
 * What Void makes on Cloudflare for an app, by the names Void gives them: the Worker (its name in
 * void.config.ts), its D1 database (`<name>-db`, when it has a db/), and a queue per file in
 * queues/ (`<name>-<file>`).
 */
export function resourcesOf(app: string) {
  // The Worker's name: the first `name` inside the config's `cloudflare` block.
  const name = readFileSync(join(app, "void.config.ts"), "utf8").match(
    /\bcloudflare:\s*\{[^]*?\bname: "([^"]+)"/,
  )?.[1];
  if (!name) throw new Error(`${app}/void.config.ts names no Worker (cloudflare.name)`);
  const queues = existsSync(join(app, "queues"))
    ? readdirSync(join(app, "queues"))
        .filter((file) => file.endsWith(".ts"))
        .map((file) => `${name}-${basename(file, ".ts")}`)
    : [];
  return { app, worker: name, database: existsSync(join(app, "db")) ? `${name}-db` : null, queues };
}

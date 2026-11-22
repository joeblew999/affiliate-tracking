// Both apps, started fresh for a test run, as Void's own integration tests start theirs
// (voidzero-dev/void, test/integration-helpers.ts): each app copied with nothing generated, so it has
// a new local database; its packages linked from the installed tree; its own workers' names, so its
// service bindings reach each other and never a `vp run dev` that's running; free ports; the
// debugger off. Each new database gets the demo seed (apps/affiliates/demo.ts, the same every
// run), so the tests start from the demo the README describes and keep it working. Nothing a run does touches your own local data. Copies go in .e2e/ (ignored), inside
// the repo so Vite serves the linked packages, and are removed after.
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { basename, join, relative } from "node:path";
import { stripVTControlCharacters } from "node:util";

const ROOT = join(import.meta.dirname, "..");

/** What an app makes when it runs, left out of its copy (as Void's test helpers leave it out). */
const GENERATED = new Set([
  ".cloudflare",
  ".env",
  ".void",
  ".void-wrangler.jsonc",
  ".wrangler",
  "dist",
  "node_modules",
]);

export interface Apps {
  shop: string;
  affiliates: string;
  /** The shared secret of the shop's calls to the service. */
  hostToken: string;
  /** The shop's Stripe webhook signing secret: tests sign their Stripe events with it. */
  webhookSecret: string;
  /** Void's token for running the service's crons in development (guide/jobs.md). */
  cronToken: () => string;
  stop: () => Promise<void>;
}

/** A free port now (another process could still take it; the app then fails to start, and says so). */
async function freePort(): Promise<number> {
  const server = createServer().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** A copy of apps/<app> in dir, its packages linked, its workers renamed with this run's id. */
function copyApp(app: "affiliates" | "shop", dir: string, id: string): string {
  const source = join(ROOT, "apps", app);
  const root = join(dir, app);
  cpSync(source, root, {
    recursive: true,
    filter: (path) => !GENERATED.has(relative(source, path).split("/")[0] ?? ""),
  });
  mkdirSync(join(root, "node_modules"));
  for (const entry of readdirSync(join(source, "node_modules"))) {
    if (entry.startsWith(".") && entry !== ".bin") continue;
    const from = join(source, "node_modules", entry);
    if (entry.startsWith("@")) {
      mkdirSync(join(root, "node_modules", entry));
      for (const name of readdirSync(from))
        symlinkSync(realpathSync(join(from, name)), join(root, "node_modules", entry, name));
    } else symlinkSync(realpathSync(from), join(root, "node_modules", entry));
  }
  // This run's worker names, so the two copies' service bindings find each other.
  const config = join(root, "void.config.ts");
  writeFileSync(
    config,
    readFileSync(config, "utf8").replace(/(name|service): "(affiliates|shop)"/g, `$1: "$2-${id}"`),
  );
  return root;
}

function run(cwd: string, args: string[], env: Record<string, string> = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("vp", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    let log = "";
    child.stdout.on("data", (d: Buffer) => (log += d));
    child.stderr.on("data", (d: Buffer) => (log += d));
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`vp ${args.join(" ")} in ${basename(cwd)}:\n${log}`)),
    );
  });
}

/** `vp dev` in an app's copy on this port; resolves once it says it's listening there. */
function serve(cwd: string, port: number, env: Record<string, string>): Promise<ChildProcess> {
  const child = spawn(
    "vp",
    ["dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      env: { ...process.env, VOID_INSPECTOR_PORT: "false", ...env },
    },
  );
  let log = "";
  return new Promise((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      process.stderr.write(chunk);
      log += stripVTControlCharacters(chunk.toString());
      if (log.includes(`http://127.0.0.1:${port}/`)) resolve(child);
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("exit", (code) => reject(new Error(`${basename(cwd)} stopped (${code}):\n${log}`)));
  });
}

/**
 * Ready once the service can ask the shop who's signed in, through its binding: on its first
 * requests Vite optimizes dependencies and reloads, dropping calls in flight. The test runner's hook
 * timeout ends the wait.
 */
async function untilReady(affiliates: string): Promise<void> {
  for (;;) {
    try {
      if ((await fetch(`${affiliates}/api/auth/get-session`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

const envFile = (values: Record<string, string>) =>
  Object.entries(values)
    .map(([key, value]) => `${key}=${value}\n`)
    .join("");

/** Both apps, fresh. `env`: more settings for both (the Stripe tests' key, say). */
export async function startApps(env: Record<string, string> = {}): Promise<Apps> {
  mkdirSync(join(ROOT, ".e2e"), { recursive: true });
  const dir = mkdtempSync(join(ROOT, ".e2e", "run-"));
  const id = basename(dir).slice(4).toLowerCase();
  const [shopPort, affiliatesPort] = [await freePort(), await freePort()];
  const shop = `http://127.0.0.1:${shopPort}`;
  const affiliates = `http://127.0.0.1:${affiliatesPort}`;
  const hostToken = randomBytes(32).toString("hex");
  const webhookSecret = `whsec_${randomBytes(32).toString("hex")}`;

  const affiliatesRoot = copyApp("affiliates", dir, id);
  const shopRoot = copyApp("shop", dir, id);
  writeFileSync(
    join(affiliatesRoot, ".env"),
    envFile({
      AFFILIATES_HOST_TOKEN: hostToken,
      HOST_SITE_URL: shop,
      AFFILIATES_IP_SALT: randomBytes(32).toString("hex"),
      AFFILIATES_HOLD_DAYS: "30",
    }),
  );
  writeFileSync(
    join(shopRoot, ".env"),
    envFile({
      AFFILIATES_HOST_TOKEN: hostToken,
      AFFILIATES_SITE_URL: affiliates,
      STRIPE_WEBHOOK_SECRET: webhookSecret,
    }),
  );
  // Each new database, migrated, then given the demo seed.
  await Promise.all(
    [affiliatesRoot, shopRoot].map(async (root) => {
      await run(root, ["run", "db:migrate"]);
      await run(root, ["run", "db:seed"]);
    }),
  );
  const servers = await Promise.all([
    serve(affiliatesRoot, affiliatesPort, env),
    serve(shopRoot, shopPort, env),
  ]);
  await untilReady(affiliates);
  return {
    shop,
    affiliates,
    hostToken,
    webhookSecret,
    cronToken: () =>
      readFileSync(join(affiliatesRoot, ".void", "dev-trigger-token"), "utf8").trim(),
    async stop() {
      for (const server of servers) if (server.pid) process.kill(-server.pid, "SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 500));
      rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    },
  };
}

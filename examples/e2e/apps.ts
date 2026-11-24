// The apps for the tests (the hub, the service and the shop), from the demo fixtures (examples/affiliates/demo.ts): started once for the
// whole run.
//
// The tests' copy of the apps is kept between runs, in .e2e/<suite>/ (ignored; inside the repo so
// Vite serves the linked packages): its database, and what Vite and Void worked out the first
// time. startSystem(), once per run, brings the copy up to date with the source as it is now,
// then starts the apps from it and stops them at the end. So a run tests the code as it is, and
// only the first run (and CI, which has no copy) pays for copying, migrating and seeding.
// The copy is made again when the installed packages change. To start over by hand, delete .e2e/.
//
// In the copy the apps have their own worker names (so their service bindings reach each other
// and never your `vp run dev`), free ports and the debugger off. Every test file uses that one
// running pair. What a file changed, and what an earlier run left, is put back before each file
// by the apps themselves: the service's "Reset demo" (examples/affiliates/src/demo-reset.ts), pressed
// by the admin like anything else (dev/each-file.ts).
//
// The service's clock is pinned (src/clock.ts): it reads DEMO_NOW when the run starts and runs on
// from there, so "on hold", "ready" and "the last 30 days" are the same on every run.
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
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
import { DEMO_NOW, HOLD_DAYS } from "../affiliates/demo.ts";

/** The repo: the hub is its root, and the example's apps and packages are in examples/. */
const ROOT = join(import.meta.dirname, "..", "..");
const APPS = ["hub", "affiliates", "shop"] as const;

/** The example's apps, with a database to migrate and seed (the hub's is migrated every run). */
const WITH_DATABASE = new Set<(typeof APPS)[number]>(["affiliates", "shop"]);

/** The hub's own files, at the repo's root: all of it that a copy of the hub is made from. */
const HUB_FILES = new Set([
  "bus.ts",
  "client.ts",
  "crons",
  "db",
  "durable-objects",
  "env.ts",
  "middleware",
  "package.json",
  "routes",
  "src",
  "tsconfig.json",
  "vite.config.ts",
  "void.config.ts",
]);

/** Where a copy's source is: the hub at the repo's root, anything else of the repo's in examples/. */
const sourceOf = (name: string) => (name === "hub" ? ROOT : join(ROOT, "examples", name));

/** Copy what a copy is made of, from its source: what's generated left out, and for the hub, all
 * but its own files. */
function copyFiles(name: string, source: string, root: string) {
  cpSync(source, root, {
    recursive: true,
    filter: (path) => {
      const top = relative(source, path).split("/")[0] ?? "";
      if (GENERATED.has(top)) return false;
      return name !== "hub" || top === "" || HUB_FILES.has(top);
    },
  });
}

/**
 * Left out of an app's copy: what it makes when it runs (as Void's test helpers leave it out), and
 * its record of what's deployed (void.lock.json), which is about the live site, not this copy.
 */
const GENERATED = new Set([
  ".cloudflare",
  ".env",
  ".void",
  ".void-wrangler.jsonc",
  ".wrangler",
  "dist",
  "node_modules",
  "void.lock.json",
]);

/** The run's two apps: where they are, and what the tests need to call them. Plain values, so
 * the run's setup can hand it to every test file. */
export interface System {
  shop: string;
  affiliates: string;
  hostToken: string;
  webhookSecret: string;
  /** Void's token for running the service's crons in development (guide/jobs.md). */
  cronToken: string;
  /** Void's token for the shop's dev inbox, where its emails are caught (guide/email/sending.md). */
  inboxToken: string;
  /** The real time (ms) at which the service's clock reads DEMO_NOW. */
  clockFrom: number;
  /** A file with what both apps have printed: shown with a failed test. */
  log: string;
}

/** Now, by the service's clock. */
export const systemNow = (system: System) => Date.parse(DEMO_NOW) + (Date.now() - system.clockFrom);

/** The end of what the apps have printed. */
export function systemOutput(system: System): string {
  try {
    return readFileSync(system.log, "utf8").slice(-20_000);
  } catch {
    return "";
  }
}

/** Every app started, to stop when the run ends, however it ends. */
const running = new Set<ChildProcess>();
const stopAll = () => {
  for (const child of running) if (child.pid) killGroup(child.pid);
};
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
  process.once(signal, () => {
    stopAll();
    process.exit(130);
  });
process.once("exit", stopAll);

/** An app's process and everything it started (it's the leader of its own process group). */
function killGroup(pid: number) {
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    // already gone
  }
}

/** A free port now (another process could still take it; the app then fails to start, and says so). */
async function freePort(): Promise<number> {
  const server = createServer().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/**
 * A copy of a folder of the repo in dir, its node_modules linked: an installed package to where
 * it's installed, and one of the repo's own (an app, or one in packages/) to its copy in dir, which
 * is made too. So nothing a run uses is a file of the repo itself, and nothing edited during a
 * run reaches it.
 */
function copyTree(name: string, root: string, dir: string): void {
  copyFiles(name, sourceOf(name), root);
  const source = sourceOf(name);
  mkdirSync(join(root, "node_modules"));
  const link = (from: string, to: string) => {
    const real = realpathSync(from);
    const own = relative(ROOT, real);
    if (own.startsWith("..") || own.split("/").includes("node_modules"))
      return symlinkSync(real, to);
    // The repo's own: the hub (its root) or examples/<name>, copied once per run's dir.
    const ownName = own === "" ? "hub" : own.replace(/^examples\//, "");
    const copy = join(dir, ownName);
    if (!existsSync(copy)) copyTree(ownName, copy, dir);
    symlinkSync(copy, to);
  };
  for (const entry of readdirSync(join(source, "node_modules"))) {
    if (entry.startsWith(".") && entry !== ".bin") continue;
    const from = join(source, "node_modules", entry);
    if (entry.startsWith("@")) {
      mkdirSync(join(root, "node_modules", entry));
      for (const name of readdirSync(from))
        link(join(from, name), join(root, "node_modules", entry, name));
    } else link(from, join(root, "node_modules", entry));
  }
}

/** A copy of an app in dir (copyTree), its workers renamed with this copy's id. */
function copyApp(app: (typeof APPS)[number], dir: string, id: string): string {
  const root = join(dir, app);
  if (!existsSync(root)) copyTree(app, root, dir);
  const config = join(root, "void.config.ts");
  writeFileSync(
    config,
    readFileSync(config, "utf8").replace(
      /(name|service): "(affiliates|shop|durable-streams)"/g,
      `$1: "$2-${id}"`,
    ),
  );
  return root;
}

/** The installed packages, as one value: the lockfile and every package.json of the repo's own. */
function installed(): string {
  const hash = createHash("sha256").update(readFileSync(join(ROOT, "pnpm-lock.yaml")));
  hash.update(readFileSync(join(ROOT, "package.json")));
  for (const name of readdirSync(join(ROOT, "examples")).sort()) {
    const manifest = join(ROOT, "examples", name, "package.json");
    if (existsSync(manifest)) hash.update(readFileSync(manifest));
  }
  return hash.digest("hex");
}

/**
 * A kept copy's source brought up to date: everything in it but what running made (GENERATED)
 * removed and copied again from the repo, so a file deleted from the source is gone from the copy
 * too. Whether its migrations changed.
 */
function refresh(dir: string): { migrated: boolean } {
  const migrations = (root: string) => {
    const folder = join(root, "db", "migrations");
    return existsSync(folder) ? readdirSync(folder).sort().join() : "";
  };
  let migrated = false;
  // The apps, and the repo's packages copied beside them (copyTree): every copy in dir.
  const copies = readdirSync(dir).filter((name) => existsSync(join(dir, name, "package.json")));
  for (const name of copies) {
    const root = join(dir, name);
    const before = migrations(root);
    for (const entry of readdirSync(root))
      if (!GENERATED.has(entry)) rmSync(join(root, entry), { recursive: true, force: true });
    copyFiles(name, sourceOf(name), root);
    migrated ||= migrations(root) !== before;
  }
  return { migrated };
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

/**
 * `vp dev` in an app's copy on this port; resolves once it says it's listening there. What it
 * prints goes to the run's log.
 */
function serve(
  cwd: string,
  port: number,
  env: Record<string, string>,
  log: string,
): Promise<ChildProcess> {
  const child = spawn(
    "vp",
    ["dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      env: {
        ...process.env,
        VOID_INSPECTOR_PORT: "false",
        // Three dev servers side by side: each tidies its memory up before it has taken a
        // gigabyte. Left to itself Node lets one grow past two (seen 2026-11-24: 2.7 GB in the
        // service's), and the machine kills it for it.
        NODE_OPTIONS: "--max-old-space-size=1024",
        ...env,
      },
    },
  );
  running.add(child);
  child.once("exit", () => running.delete(child));
  let started = "";
  let ready = false;
  return new Promise((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      const text = stripVTControlCharacters(chunk.toString());
      appendFileSync(log, `[${basename(cwd)}] ${text}`);
      if (ready) return;
      started += text;
      if (started.includes(`http://127.0.0.1:${port}/`)) {
        ready = true;
        resolve(child);
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("exit", (code) => {
      if (!ready) reject(new Error(`${basename(cwd)} stopped (${code}):\n${started}`));
    });
  });
}

/**
 * Ready once the service can ask the shop who's signed in, through its binding. The test runner's
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

/**
 * Once per run: both apps, seeded and running. `env`: more settings for both (the Stripe tests'
 * keys). `webhookSecret`: the shop's Stripe webhook secret, when Stripe itself signs the events.
 * `suite`: whose kept copy (each suite has its own, with its own database).
 */
export async function startSystem(
  env: Record<string, string> = {},
  webhookSecret = `whsec_${randomBytes(32).toString("hex")}`,
  suite = "dev",
): Promise<{ system: System; stop: () => Promise<void> }> {
  const dir = join(ROOT, ".e2e", suite);
  const stamp = join(dir, "installed");
  const packages = installed();
  // A copy made with other packages installed is no use: its links are to the old ones.
  if (existsSync(dir) && (!existsSync(stamp) || readFileSync(stamp, "utf8") !== packages))
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  const kept = existsSync(dir);
  mkdirSync(dir, { recursive: true });
  const log = join(dir, "apps.log");
  writeFileSync(log, "");
  const hostToken = randomBytes(32).toString("hex");
  const secret = randomBytes(32).toString("hex");
  const clockFrom = Date.now();
  // The service's clock settings (src/clock.ts) for this run.
  const clock = { AFFILIATES_NOW: DEMO_NOW, AFFILIATES_NOW_FROM: String(clockFrom) };
  const hubToken = randomBytes(32).toString("hex");
  const [shopPort, affiliatesPort, hubPort] = [
    await freePort(),
    await freePort(),
    await freePort(),
  ];
  const shop = `http://127.0.0.1:${shopPort}`;
  const affiliates = `http://127.0.0.1:${affiliatesPort}`;
  const { migrated } = kept ? refresh(dir) : { migrated: false };
  const roots = Object.fromEntries(APPS.map((app) => [app, copyApp(app, dir, "e2e")])) as Record<
    (typeof APPS)[number],
    string
  >;
  // The hub starts every run with nothing stored (Void keeps an app's local D1 and durable
  // objects in its .void/v3): an earlier run's streams are no use to this one, and its subscribers
  // gave addresses (that run's ports) nobody answers at now. Its database is migrated again below.
  rmSync(join(roots.hub, ".void", "v3"), { recursive: true, force: true });
  if (!kept)
    // Void's generated types and config, as after a fresh clone. One app after another: the shop
    // reads the service's (it imports its client), so the service's must be there first.
    for (const app of APPS) await run(roots[app], ["exec", "void", "prepare"]);
  await Promise.all(
    APPS.filter((app) => WITH_DATABASE.has(app)).map(async (app) => {
      if (!kept || migrated) await run(roots[app], ["run", "db:migrate"]);
      if (!kept) await run(roots[app], ["run", "db:seed"], clock);
    }),
  );
  // The hub's streams' tables, in its emptied D1 (Void applies migrations by hand in development).
  await run(roots.hub, ["run", "db:migrate"]);
  writeFileSync(stamp, packages);
  writeFileSync(join(roots.hub, ".env"), envFile({ HUB_TOKEN: hubToken }));
  writeFileSync(
    join(roots.affiliates, ".env"),
    envFile({
      AFFILIATES_HOST_TOKEN: hostToken,
      HUB_TOKEN: hubToken,
      HOST_SITE_URL: shop,
      // Where the hub wakes the service.
      AFFILIATES_SITE_URL: affiliates,
      AFFILIATES_IP_SALT: secret,
      AFFILIATES_HOLD_DAYS: String(HOLD_DAYS),
      // A demo site: the tests put the demo back between files (dev/each-file.ts).
      AFFILIATES_DEMO: "on",
      ...clock,
    }),
  );
  writeFileSync(
    join(roots.shop, ".env"),
    envFile({
      AFFILIATES_HOST_TOKEN: hostToken,
      HUB_TOKEN: hubToken,
      // Where the hub wakes the shop.
      SHOP_SITE_URL: shop,
      AFFILIATES_SITE_URL: affiliates,
      STRIPE_WEBHOOK_SECRET: webhookSecret,
      EMAIL_LINK_SECRET: secret, // any long random value for the run
    }),
  );
  const servers = await Promise.all([
    serve(roots.hub, hubPort, {}, log),
    serve(roots.affiliates, affiliatesPort, env, log),
    serve(roots.shop, shopPort, env, log),
  ]);
  await untilReady(affiliates);
  return {
    system: {
      shop,
      affiliates,
      hostToken,
      webhookSecret,
      cronToken: readFileSync(join(roots.affiliates, ".void", "dev-trigger-token"), "utf8").trim(),
      inboxToken: readFileSync(join(roots.shop, ".void", "dev-trigger-token"), "utf8").trim(),
      clockFrom,
      log,
    },
    // Each app stopped (its process group). The copy stays for the next run.
    async stop() {
      await Promise.all(
        servers.map(
          (server) =>
            new Promise<void>((resolve) => {
              if (server.exitCode !== null || !server.pid) return resolve();
              server.once("exit", () => resolve());
              killGroup(server.pid);
            }),
        ),
      );
    },
  };
}

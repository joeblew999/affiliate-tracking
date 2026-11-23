// Both apps for the tests, from the demo fixtures (apps/affiliates/demo.ts): started once for the
// whole run.
//
// startSystem(), once per run: both apps copied (nothing generated), migrated and seeded with the
// fixtures, dated from DEMO_NOW, given their own worker names (so their service bindings reach
// each other and never your `vp run dev`), free ports and the debugger off, and started. Every
// test file uses that one running pair. What a file changed is put back before the next by the
// apps themselves: the service's "Reset demo" (apps/affiliates/src/demo-reset.ts), pressed by the
// admin like anything else (dev/each-file.ts). So no file pays for the apps starting again.
//
// The service's clock is pinned (src/clock.ts): it reads DEMO_NOW when the run starts and runs on
// from there, so "on hold", "ready" and "the last 30 days" are the same on every run.
// The copy goes in .e2e/ (ignored), inside the repo so Vite serves the linked packages; removed after.
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  cpSync,
  existsSync,
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
import { DEMO_NOW, HOLD_DAYS } from "../apps/affiliates/demo.ts";

const ROOT = join(import.meta.dirname, "..");
const APPS = ["affiliates", "shop"] as const;

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
function copyTree(source: string, root: string, dir: string): void {
  cpSync(source, root, {
    recursive: true,
    filter: (path) => !GENERATED.has(relative(source, path).split("/")[0] ?? ""),
  });
  mkdirSync(join(root, "node_modules"));
  const link = (from: string, to: string) => {
    const real = realpathSync(from);
    const own = relative(ROOT, real);
    if (own.startsWith("..") || own.split("/").includes("node_modules"))
      return symlinkSync(real, to);
    // The repo's own: apps/<name> or packages/<name>, copied once per run's dir.
    const copy = join(dir, own.replace(/^apps\//, ""));
    if (!existsSync(copy)) copyTree(real, copy, dir);
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

/** A copy of apps/<app> in dir (copyTree), its workers renamed with this copy's id. */
function copyApp(app: (typeof APPS)[number], dir: string, id: string): string {
  const root = join(dir, app);
  if (!existsSync(root)) copyTree(join(ROOT, "apps", app), root, dir);
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
      env: { ...process.env, VOID_INSPECTOR_PORT: "false", ...env },
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
 */
export async function startSystem(
  env: Record<string, string> = {},
  webhookSecret = `whsec_${randomBytes(32).toString("hex")}`,
): Promise<{ system: System; stop: () => Promise<void> }> {
  mkdirSync(join(ROOT, ".e2e"), { recursive: true });
  const dir = mkdtempSync(join(ROOT, ".e2e", "run-"));
  const log = join(dir, "apps.log");
  writeFileSync(log, "");
  const hostToken = randomBytes(32).toString("hex");
  const secret = randomBytes(32).toString("hex");
  const clockFrom = Date.now();
  // The service's clock settings (src/clock.ts) for this run.
  const clock = { AFFILIATES_NOW: DEMO_NOW, AFFILIATES_NOW_FROM: String(clockFrom) };
  const [shopPort, affiliatesPort] = [await freePort(), await freePort()];
  const shop = `http://127.0.0.1:${shopPort}`;
  const affiliates = `http://127.0.0.1:${affiliatesPort}`;
  const roots = Object.fromEntries(
    await Promise.all(
      APPS.map(async (app) => {
        const root = copyApp(app, dir, "e2e");
        // Void's generated types and config (the shop's seed reads its Better Auth schema), as
        // after a fresh clone.
        await run(root, ["exec", "void", "prepare"]);
        await run(root, ["run", "db:migrate"]);
        await run(root, ["run", "db:seed"], clock);
        return [app, root] as const;
      }),
    ),
  ) as Record<(typeof APPS)[number], string>;
  writeFileSync(
    join(roots.affiliates, ".env"),
    envFile({
      AFFILIATES_HOST_TOKEN: hostToken,
      HOST_SITE_URL: shop,
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
      AFFILIATES_SITE_URL: affiliates,
      STRIPE_WEBHOOK_SECRET: webhookSecret,
      EMAIL_LINK_SECRET: secret, // any long random value for the run
    }),
  );
  const servers = await Promise.all([
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
    // Each app stopped (its process group), then the run's copy removed.
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
      rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    },
  };
}

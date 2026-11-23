// Both apps for the tests, as Void's own integration tests run theirs (voidzero-dev/void,
// test/integration-helpers.ts), from the demo fixtures (apps/affiliates/demo.ts):
//
// - prepareApps(), once per run: both apps copied (nothing generated), migrated and seeded with the
//   fixtures, dated from DEMO_NOW. That seeded state is the template.
// - startApps(), once per test file: both apps copied again, given a copy of the template's
//   databases, their own worker names (so their service bindings reach each other and never your
//   `vp run dev`), free ports and the debugger off, and started. So every file starts from exactly
//   the fixtures, and nothing a file changes reaches another, or your local data.
//
// The service's clock is pinned (src/clock.ts): it reads DEMO_NOW when the run starts and runs on
// from there, so "on hold", "ready" and "the last 30 days" are the same on every run.
// Copies go in .e2e/ (ignored), inside the repo so Vite serves the linked packages; removed after.
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
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

/** The run's seeded template, and what every test file's apps share. */
export interface Template {
  dir: string;
  hostToken: string;
  webhookSecret: string;
  ipSalt: string;
  /** The real time (ms) at which the service's clock reads DEMO_NOW. */
  clockFrom: number;
}

export interface Apps {
  shop: string;
  affiliates: string;
  hostToken: string;
  webhookSecret: string;
  /** Void's token for running the service's crons in development (guide/jobs.md). */
  cronToken: string;
  /** Void's token for the shop's dev inbox, where its emails are caught (guide/email/sending.md). */
  inboxToken: string;
  /** Now, by the service's clock. */
  now: () => number;
  /**
   * Call `listener` with the error as soon as either app reports work that failed: a queue job or a
   * scheduled job (Void logs "[void] … failed" and the error), so a test stops then, not at a timeout.
   */
  onFailure: (listener: (error: string) => void) => void;
  /** What each app has printed lately: shown with a failed test, so it says what went wrong. */
  output: () => string;
  stop: () => Promise<void>;
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

/** What an app reports when its own work fails (Void's dev runtime, for queues and crons). */
const FAILED = /\[void\] (Queue handler|Scheduled job) .* failed/;

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
 * `vp dev` in an app's copy on this port; resolves once it says it's listening there. After that,
 * `failed` hears of each failure the app reports, with what it logged.
 */
function serve(
  cwd: string,
  port: number,
  env: Record<string, string>,
  failed: (error: string) => void,
  printed: string[],
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
  let log = "";
  let ready = false;
  return new Promise((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      const text = stripVTControlCharacters(chunk.toString());
      log += text;
      printed.push(`[${basename(cwd)}] ${text}`);
      if (printed.length > 400) printed.splice(0, printed.length - 400);
      if (!ready && log.includes(`http://127.0.0.1:${port}/`)) {
        ready = true;
        log = "";
        resolve(child);
      }
      if (!ready) return;
      // The failure's line and its error (logged with it, in one write).
      const at = log.search(FAILED);
      if (at !== -1) {
        failed(`${basename(cwd)}: ${log.slice(at, at + 4000)}`);
        log = "";
      }
      log = log.slice(-2000);
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("exit", (code) => {
      if (ready) failed(`${basename(cwd)} stopped (${code}):\n${log}`);
      else reject(new Error(`${basename(cwd)} stopped (${code}):\n${log}`));
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

/** The service's clock settings (src/clock.ts) for this run. */
const clockEnv = (template: Template) => ({
  AFFILIATES_NOW: DEMO_NOW,
  AFFILIATES_NOW_FROM: String(template.clockFrom),
});

/** Once per run: both apps migrated and seeded with the fixtures, in .e2e/<run>/template. */
export async function prepareApps(): Promise<Template> {
  mkdirSync(join(ROOT, ".e2e"), { recursive: true });
  const dir = mkdtempSync(join(ROOT, ".e2e", "run-"));
  const template: Template = {
    dir: join(dir, "template"),
    hostToken: randomBytes(32).toString("hex"),
    webhookSecret: `whsec_${randomBytes(32).toString("hex")}`,
    ipSalt: randomBytes(32).toString("hex"),
    clockFrom: Date.now(),
  };
  await Promise.all(
    APPS.map(async (app) => {
      const root = copyApp(app, template.dir, "template");
      // Void's generated types and config (the shop's seed reads its Better Auth schema), as after
      // a fresh clone.
      await run(root, ["exec", "void", "prepare"]);
      await run(root, ["run", "db:migrate"]);
      await run(root, ["run", "db:seed"], clockEnv(template));
    }),
  );
  return template;
}

/** Remove the run's copies. */
export function removeApps(template: Template): void {
  rmSync(join(template.dir, ".."), {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 100,
  });
}

/** Once per test file: both apps from the template, started. `env`: more settings for both. */
export async function startApps(
  template: Template,
  env: Record<string, string> = {},
): Promise<Apps> {
  const dir = mkdtempSync(join(template.dir, "..", "file-"));
  const id = basename(dir).slice(5).toLowerCase();
  const [shopPort, affiliatesPort] = [await freePort(), await freePort()];
  const shop = `http://127.0.0.1:${shopPort}`;
  const affiliates = `http://127.0.0.1:${affiliatesPort}`;
  const roots = Object.fromEntries(
    APPS.map((app) => {
      const root = copyApp(app, dir, id);
      // The template's seeded databases (.void/v3: Void's local state; the database's identity
      // comes from void.lock.json, copied with the app).
      cpSync(join(template.dir, app, ".void", "v3"), join(root, ".void", "v3"), {
        recursive: true,
      });
      return [app, root];
    }),
  ) as Record<(typeof APPS)[number], string>;
  writeFileSync(
    join(roots.affiliates, ".env"),
    envFile({
      AFFILIATES_HOST_TOKEN: template.hostToken,
      HOST_SITE_URL: shop,
      AFFILIATES_IP_SALT: template.ipSalt,
      AFFILIATES_HOLD_DAYS: String(HOLD_DAYS),
      ...clockEnv(template),
    }),
  );
  writeFileSync(
    join(roots.shop, ".env"),
    envFile({
      AFFILIATES_HOST_TOKEN: template.hostToken,
      AFFILIATES_SITE_URL: affiliates,
      STRIPE_WEBHOOK_SECRET: template.webhookSecret,
      EMAIL_LINK_SECRET: template.ipSalt, // any long random value for the run
    }),
  );
  const listeners: ((error: string) => void)[] = [];
  let stopping = false;
  const failed = (error: string) => {
    if (!stopping) for (const listener of listeners) listener(error);
  };
  const printed: string[] = [];
  const servers = await Promise.all([
    serve(roots.affiliates, affiliatesPort, env, failed, printed),
    serve(roots.shop, shopPort, env, failed, printed),
  ]);
  await untilReady(affiliates);
  return {
    shop,
    affiliates,
    hostToken: template.hostToken,
    webhookSecret: template.webhookSecret,
    cronToken: readFileSync(join(roots.affiliates, ".void", "dev-trigger-token"), "utf8").trim(),
    inboxToken: readFileSync(join(roots.shop, ".void", "dev-trigger-token"), "utf8").trim(),
    now: () => Date.parse(DEMO_NOW) + (Date.now() - template.clockFrom),
    onFailure: (listener) => void listeners.push(listener),
    output: () => printed.join("").slice(-20_000),
    async stop() {
      stopping = true;
      // Each app stopped (its process group), then its copy removed.
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

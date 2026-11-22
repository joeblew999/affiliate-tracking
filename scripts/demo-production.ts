// `vp run demo:production`: replaces the data of both deployed apps with the demo (README, "Demo
// data"). For the demo deployment only: it deletes everything in their databases first, real
// sign-ups included. Run it after `void cloudflare login`, from the repo's root.
//
// Void has no remote seed, so for each app: `void db seed` makes the demo in the local database,
// `void db export --no-schema` writes its rows as SQL, and `void db execute --remote --file` runs
// that, after deleting what's there, against the deployed database. Your local databases end up
// with the demo too.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

/** Each app's tables, children before parents, so the deletes keep foreign keys whole. */
const APPS = {
  shop: ["session", "account", "verification", "subscription", "user"],
  affiliates: [
    "clicks",
    "sales",
    "referrals",
    "payouts",
    "links",
    "commission_rules",
    "refunded_payments",
    "partner_ip_hashes",
    "partners",
  ],
} as const;

function voidIn(app: string, args: string[]) {
  const run = spawnSync("node_modules/.bin/void", args, { cwd: `apps/${app}`, stdio: "inherit" });
  if (run.status !== 0) throw new Error(`${app}: void ${args.join(" ")} failed`);
}

mkdirSync(".demo", { recursive: true });
for (const [app, tables] of Object.entries(APPS)) {
  const exported = `.demo/${app}.sql`;
  const load = `.demo/${app}-production.sql`;
  voidIn(app, ["db", "seed", "--yes"]);
  voidIn(app, ["db", "export", "--no-schema", "--output", `../../${exported}`]);
  writeFileSync(
    load,
    [
      // The export lists tables alphabetically, not parents first: check foreign keys at the end.
      "PRAGMA defer_foreign_keys = true;",
      ...tables.map((table) => `DELETE FROM "${table}";`),
      readFileSync(exported, "utf8"),
    ].join("\n"),
  );
  voidIn(app, ["db", "execute", "--remote", "--file", `../../${load}`, "--yes"]);
  console.log(`${app}: the deployed database now has the demo data`);
}

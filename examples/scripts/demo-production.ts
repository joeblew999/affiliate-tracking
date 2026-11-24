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

/**
 * Each app's tables. `load`: replaced by the demo's rows. `clear`: emptied, nothing loaded (who's
 * signed in). `keep`: left as they are, the demo's rows not loaded. Deleted in the order listed, `clear` then `load`, children before
 * parents; rows inserted in the reverse, so every foreign key points at a row that's there. (A D1
 * import checks them statement by statement, and the export lists tables alphabetically.)
 */
const APPS = {
  shop: {
    clear: ["session", "verification"],
    load: ["account", "user"],
    keep: [],
  },
  affiliates: {
    clear: [],
    load: [
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
    keep: [],
  },
} as const;

type Tables = { clear: readonly string[]; load: readonly string[]; keep: readonly string[] };

/** The export's INSERT statements (one a line) for the `load` tables, parent tables first. */
function parentsFirst(sql: string, { clear, load, keep }: Tables): string[] {
  const statements = sql.split("\n").filter((line) => line.startsWith("INSERT INTO "));
  const tableOf = (line: string) => /^INSERT INTO "([^"]+)"/.exec(line)?.[1] ?? "";
  const known = [...clear, ...load, ...keep];
  const unknown = statements.filter((line) => !known.includes(tableOf(line)));
  if (unknown.length)
    throw new Error(`a table this script doesn't know: ${tableOf(unknown[0] ?? "")}`);
  return [...load]
    .reverse()
    .flatMap((table) => statements.filter((line) => tableOf(line) === table));
}

function voidIn(app: string, args: string[]) {
  const run = spawnSync("node_modules/.bin/void", args, {
    cwd: `examples/${app}`,
    stdio: "inherit",
  });
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
      ...[...tables.clear, ...tables.load].map((table) => `DELETE FROM "${table}";`),
      ...parentsFirst(readFileSync(exported, "utf8"), tables),
    ].join("\n"),
  );
  voidIn(app, ["db", "execute", "--remote", "--file", `../../${load}`, "--yes"]);
  console.log(`${app}: the deployed database now has the demo data`);
}

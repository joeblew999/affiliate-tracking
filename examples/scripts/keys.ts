// `vp run setup`, last step: a key for the hub in each example app's .env (HUB_KEY), where it has
// none. The hub makes them itself (its Better Auth's API keys): it's started for a moment, its
// local admin makes one key per app, in the "example" organization, and it's stopped again.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { localAdmin, startHub } from "../../scripts/hub-dev.ts";
import { hubKey } from "../../scripts/key.ts";

const APPS = ["affiliates", "shop"];
const envOf = (app: string) => `examples/${app}/.env`;
const read = (app: string) => (existsSync(envOf(app)) ? readFileSync(envOf(app), "utf8") : "");
const missing = APPS.filter((app) => !/^HUB_KEY=.+$/m.test(read(app)));

if (missing.length > 0) {
  const hub = await startHub();
  try {
    for (const app of missing) {
      const key = await hubKey({
        url: hub.url,
        ...localAdmin(),
        name: app,
        organization: "example",
      });
      const text = read(app).replace(/^HUB_(KEY|TOKEN)=.*\n?/gm, "");
      writeFileSync(
        envOf(app),
        `${text}${text && !text.endsWith("\n") ? "\n" : ""}HUB_KEY=${key}\n`,
      );
      console.log(`${envOf(app)}: HUB_KEY`);
    }
  } finally {
    await hub.stop();
  }
}

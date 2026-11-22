// Before each test file: both apps started from the run's seeded template (../apps.ts), so the
// file starts from exactly the demo fixtures. After it: its browsers closed, its apps stopped.
// (The Stripe suite, when not asked for, has no template and starts nothing.)
import { afterAll, inject } from "vite-plus/test";
import { startApps, type Apps } from "../apps.ts";

declare global {
  /** This test file's apps (helpers.ts reads them). */
  var apps: Apps;
}

const template = inject("template");
if (template) {
  globalThis.apps = await startApps(template, inject("appEnv"));
  afterAll(async () => {
    const { closeBrowsers } = await import("./helpers.ts");
    await closeBrowsers();
    await globalThis.apps.stop();
  });
}

// Before each test file: both apps started from the run's seeded template (../apps.ts), so the
// file starts from exactly the demo fixtures. Each test starts with nothing failed (helpers.ts
// fails a test the moment either app reports an error). After it: its browsers closed, its apps stopped.
// (The Stripe suite, when not asked for, has no template and starts nothing.)
import { afterAll, beforeEach, inject, onTestFailed } from "vite-plus/test";
import { startApps, type Apps } from "../apps.ts";

declare global {
  /** This test file's apps (helpers.ts reads them). */
  var apps: Apps;
}

const template = inject("template");
if (template) {
  globalThis.apps = await startApps(template, inject("appEnv"));
  const { startTest } = await import("./helpers.ts");
  beforeEach(() => {
    startTest();
    // A failed test shows what both apps printed, so the failure says what went wrong.
    onTestFailed(() => {
      console.log(`--- what the apps printed ---\n${globalThis.apps.output()}`);
    });
  });
  afterAll(async () => {
    const { closeBrowsers } = await import("./helpers.ts");
    await closeBrowsers();
    await globalThis.apps.stop();
  });
}

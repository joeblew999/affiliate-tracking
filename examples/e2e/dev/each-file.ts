// Before each test file: the run's two apps (../apps.ts), with the demo put back as it was, by the
// admin pressing "Reset demo" (helpers.ts), so the file starts from exactly the fixtures whatever
// the files before it changed. Each test starts with nothing failed. After the file: its browsers
// closed. (The Stripe suite, when not asked for, has no apps and does nothing.)
import { afterAll, beforeAll, beforeEach, inject, onTestFailed } from "vite-plus/test";
import { systemNow, systemOutput, type System } from "../apps.ts";

declare global {
  /** The run's apps (helpers.ts reads them). */
  var apps: System & { now: () => number };
}

const system = inject("system");
if (system) {
  globalThis.apps = { ...system, now: () => systemNow(system) };
  const { closeBrowsers, startTest } = await import("./helpers.ts");
  const { closeBus, resetDemo } = await import("./bus.ts");
  beforeAll(resetDemo);
  beforeEach(() => {
    startTest();
    // A failed test shows what both apps printed, so the failure says what went wrong.
    onTestFailed(() => {
      console.log(`--- what the apps printed ---\n${systemOutput(system)}`);
    });
  });
  afterAll(closeBrowsers);
  afterAll(closeBus);
}

// The Durable Streams protocol's own conformance tests (@durable-streams/server-conformance-tests),
// subscriptions included, run against the hub itself under `vp dev` (./app.ts).
// They are the protocol's authors' tests, so passing them is what "behaves as the protocol says"
// means here.
import { runConformanceTests } from "@durable-streams/server-conformance-tests";
import { afterAll, beforeAll } from "vite-plus/test";
import { startApp, type App } from "./app.ts";

const options = { baseUrl: "", subscriptions: true };
let app: App | undefined;

beforeAll(async () => {
  app = await startApp();
  options.baseUrl = app.url;
});

afterAll(() => app?.stop());

runConformanceTests(options);

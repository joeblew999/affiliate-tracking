// The Durable Streams protocol's own conformance tests (@durable-streams/server-conformance-tests),
// subscriptions included, run against this package in its Void app (../app) under `vp dev`.
// They are the protocol's authors' tests, so passing them is what "behaves as the protocol says"
// means here.
import { runConformanceTests } from "@durable-streams/server-conformance-tests";
import { afterAll, beforeAll } from "vite-plus/test";
import { emptyApp, startApp, type App } from "./app.ts";

const options = { baseUrl: "", subscriptions: true };
let app: App | undefined;

beforeAll(async () => {
  emptyApp();
  app = await startApp();
  options.baseUrl = app.url;
});

afterAll(() => app?.stop());

runConformanceTests(options);

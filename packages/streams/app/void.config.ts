import { defineConfig } from "void/config";

// The smallest Void app that serves Durable Streams with subscriptions (packages/streams), open to
// anyone: what the protocol's own conformance tests are run against (../test). Not deployed.
export default defineConfig({ cloudflare: { name: "streams-app" } });

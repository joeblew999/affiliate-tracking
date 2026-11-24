import { defineConfig } from "void/config";

// cloudflare-durable-streams: Durable Streams on Cloudflare, as a Void app (README). Any worker,
// local or deployed, makes streams here, writes to them, reads them and follows them; the hub
// knows none of them: no bindings to other workers, no list of who follows what.
export default defineConfig({
  // The streams are in D1 (src/streams.ts), with read replicas: a stream is read from the replica
  // nearest the Worker reading it, and a client's bookmark keeps it from reading older than it has
  // seen (Void's guide/database/d1.md, "Read replication").
  database: { readReplication: true },
  cloudflare: {
    name: "durable-streams",
    // Its own address (https://durable-streams.<account>.workers.dev), for any worker: local ones,
    // and ones on other accounts. Every call needs HUB_TOKEN (middleware/01.workers.ts). A worker
    // on the same account can use a service binding to it instead.
    workers_dev: true,
    preview_urls: false,
  },
});

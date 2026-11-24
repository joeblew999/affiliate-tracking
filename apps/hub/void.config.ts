import { defineConfig } from "void/config";

// The hub: the streams every worker of the program writes to and follows (README, "The hub"). It
// knows none of them: no bindings to other workers, no list of who follows what.
export default defineConfig({
  // The streams are in D1 (src/streams.ts), with read replicas: a stream is read from the replica
  // nearest the Worker reading it, and a client's bookmark keeps it from reading older than it has
  // seen (Void's guide/database/d1.md, "Read replication").
  database: { readReplication: true },
  cloudflare: {
    name: "hub",
    // No address of its own: workers call it through their bindings to it.
    workers_dev: false,
    preview_urls: false,
  },
});

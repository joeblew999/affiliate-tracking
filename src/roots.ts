// Where the streams are. A Worker finds them at the protocol's reference path; inside, each
// organization's are under a root of its own (src/streams.ts).

/** Where a Worker finds the streams: the protocol's reference path. */
export const ROOT = "/v1/stream";

/** Where an organization's streams are, inside. */
export const rootOf = (organization: string) => `/v1/o/${organization}/stream`;

// Which streams a subscription's pattern covers, as the protocol says (PROTOCOL.md, section 6.2):
// `*` is exactly one part of a path, `**` any number of parts, anything else itself. From the
// Durable Streams reference server (durable-streams/durable-streams, packages/server/src/glob.ts,
// Apache-2.0).

const parts = (path: string) => path.split("/").filter((part) => part.length > 0);

function match(pattern: string[], pi: number, path: string[], si: number): boolean {
  while (pi < pattern.length && si < path.length) {
    const part = pattern[pi];
    if (part === "**") {
      for (let i = si; i <= path.length; i++) if (match(pattern, pi + 1, path, i)) return true;
      return false;
    }
    // A written-out star (%2A) in a pattern is a star in the path's name.
    if (part !== "*" && part?.replace(/%2[Aa]/g, "*") !== path[si]) return false;
    pi++;
    si++;
  }
  while (pattern[pi] === "**") pi++;
  return pi === pattern.length && si === path.length;
}

/** Whether the stream at `path` is one the pattern covers. */
export const globMatch = (pattern: string, path: string) =>
  match(parts(pattern), 0, parts(path), 0);

/** A path without slashes at its ends, as subscriptions name streams (relative to the root). */
export const relative = (path: string) => path.replace(/^\/+/, "").replace(/\/+$/, "");

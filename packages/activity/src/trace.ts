// Which action the current work belongs to (packages/activity/src/server.ts sets it). Its own
// module, with nothing from Void's runtime, so code shared with other places (an app's client for
// the other app) can carry it on its calls.
import { AsyncLocalStorage } from "node:async_hooks";

/** Who sees an action: a person's user id, and "admins". */
export type Viewers = string[];

/** Where a step is: its action, and who sees it. */
export type Trace = { actionId: string; viewers: Viewers };

export const HEADER = "x-activity";
export const current = new AsyncLocalStorage<Trace>();

/** The header that carries the current action to the other app (set on calls over a binding). */
export function activityHeaders(): Record<string, string> {
  const trace = current.getStore();
  return trace ? { [HEADER]: JSON.stringify(trace) } : {};
}

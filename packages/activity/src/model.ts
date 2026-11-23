// The control plane's model: what the system's work reports as it runs (an event), and what a
// viewer sees (their actions, each with its steps). The same for any Void app: nothing here knows
// what the app does.
//
// An action is what a person (or Stripe, or the clock) started: a press of "Book event". Its steps
// are the work it caused, in either app: the request itself, each queued message, each email.
// It's running while any step is queued or running, done when every step is done, and failed while
// any step has failed (a retry that succeeds makes it done again).
import { z } from "zod";

export const StepStatus = z.enum(["queued", "running", "done", "failed"]);
export type StepStatus = z.infer<typeof StepStatus>;

export const Step = z.object({
  id: z.string(),
  /** What the step is, in plain words: "Book event", "payouts", "email". */
  name: z.string(),
  /** The app it ran in. */
  app: z.string(),
  status: StepStatus,
  /** Why it failed, while it has. */
  error: z.string().nullable(),
  at: z.number(),
});
export type Step = z.infer<typeof Step>;

export const Action = z.object({
  id: z.string(),
  /** What started it: "Book event", "Stripe checkout.session.completed", "Daily job". */
  title: z.string(),
  /** Who started it, as people see them; null for Stripe and the clock. */
  by: z.string().nullable(),
  startedAt: z.number(),
  state: z.enum(["running", "done", "failed"]),
  steps: z.array(Step),
});
export type Action = z.infer<typeof Action>;

/** What the work reports, one event at a time. */
export const ActivityEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("started"),
    actionId: z.string(),
    title: z.string(),
    by: z.string().nullable(),
    at: z.number(),
  }),
  z.object({
    type: z.literal("step"),
    actionId: z.string(),
    step: Step,
  }),
]);
export type ActivityEvent = z.infer<typeof ActivityEvent>;

/** What a viewer's page receives: everything at once when it connects, then each change. */
export const ServerMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("snapshot"), actions: z.array(Action) }),
  z.object({ type: z.literal("action"), action: Action }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

/** A page sends nothing; the room only talks. */
export const ClientMessage = z.object({ type: z.literal("hello") });

/** How many finished actions a viewer keeps, besides any still running. */
export const KEEP_FINISHED = 20;

/** An action's state, from its steps. */
function stateOf(steps: Step[]): Action["state"] {
  if (steps.some((s) => s.status === "failed")) return "failed";
  if (steps.some((s) => s.status === "queued" || s.status === "running")) return "running";
  return "done";
}

/**
 * Apply one event to a viewer's actions: the action it's about, as it is now. Events can arrive in
 * any order (the two apps report separately), so a step for an action not yet started makes a
 * placeholder, which its "started" fills in.
 */
export function apply(actions: Map<string, Action>, event: ActivityEvent): Action {
  const current = actions.get(event.actionId) ?? {
    id: event.actionId,
    title: "…",
    by: null,
    startedAt: event.type === "started" ? event.at : event.step.at,
    state: "running" as const,
    steps: [],
  };
  let next: Action;
  if (event.type === "started") {
    next = { ...current, title: event.title, by: event.by, startedAt: event.at };
  } else {
    const steps = current.steps.filter((s) => s.id !== event.step.id);
    const before = current.steps.find((s) => s.id === event.step.id);
    // A step's own events can cross on the way: a later status never goes back to "queued".
    if (before && before.status !== "queued" && event.step.status === "queued") steps.push(before);
    else steps.push(event.step);
    steps.sort((a, b) => a.at - b.at);
    next = { ...current, steps, state: stateOf(steps) };
  }
  actions.set(next.id, next);
  return next;
}

/** The actions a viewer keeps: every one still running, and the latest finished ones. */
export function kept(actions: Map<string, Action>): Action[] {
  const all = [...actions.values()].sort((a, b) => b.startedAt - a.startedAt);
  const finished = all.filter((a) => a.state !== "running").slice(KEEP_FINISHED);
  for (const old of finished) actions.delete(old.id);
  return [...actions.values()].sort((a, b) => b.startedAt - a.startedAt);
}

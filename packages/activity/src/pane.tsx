// The Activity pane: on every page of both apps, the viewer's actions and the steps each caused,
// live from their room in the control plane (the shop's /activity/[viewer], Void's WebSocket
// rooms). Failures are red, with the step and its error. When an action finishes, the page reloads
// its data (Void's router.refresh()), so what it shows is what's now saved.
//
// For people and tests alike: data-live on the pane says whether it's listening ("connected" once
// the room has sent its state), and each action carries data-action, data-title, data-by and
// data-state, so a test can find one without depending on the wording.
import { useNavigation, useRouter } from "@void/react";
import { useEffect, useRef, useState } from "react";
import { connect } from "void/ws";
import { ServerMessage, type Action } from "./model.ts";

type Props = {
  /** The shop's address: where the control plane is. */
  controlPlane: string;
  /** Whose activity: the signed-in user's id, or "admins" for an admin. */
  viewer: string;
};

const STATE_WORDS: Record<Action["state"], string> = {
  running: "running",
  done: "done",
  failed: "failed",
};

export function ActivityPane({ controlPlane, viewer }: Props) {
  const [actions, setActions] = useState<Action[]>([]);
  // What's shown, also outside React's state, so a message can compare with it as it arrives.
  const shown = useRef<Action[]>([]);
  const [live, setLive] = useState<"connecting" | "connected" | "reconnecting">("connecting");
  // Open or closed stays as the person left it, from page to page (this browser only).
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem("activity-pane") === "open");
    } catch {
      // no storage here: closed
    }
  }, []);
  const toggle = () =>
    setOpen((was) => {
      try {
        localStorage.setItem("activity-pane", was ? "closed" : "open");
      } catch {
        // no storage here: just this page
      }
      return !was;
    });
  const router = useRouter();
  const navigation = useNavigation();
  // Reloading the page's data while the page has its own request in flight (a form being sent)
  // would abort that request. So a reload waits until the page is idle; one at a time, and once
  // more afterwards if more work finished meanwhile.
  const refreshing = useRef({ busy: false, again: false, waiting: false });
  const idle = useRef(true);
  idle.current = navigation.state === "idle";
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  refreshRef.current = async () => {
    const r = refreshing.current;
    if (!idle.current) {
      r.waiting = true;
      return;
    }
    if (r.busy) {
      r.again = true;
      return;
    }
    r.busy = true;
    do {
      r.again = false;
      await router.refresh({ resolveOn: "data" });
    } while (r.again);
    r.busy = false;
  };
  useEffect(() => {
    if (navigation.state === "idle" && refreshing.current.waiting) {
      refreshing.current.waiting = false;
      void refreshRef.current();
    }
  }, [navigation.state]);

  useEffect(() => {
    const refresh = () => refreshRef.current();
    // The room is the other app's route on another address, so it isn't in this app's typed routes.
    const socket = connect(
      "/activity/[viewer]" as never,
      {
        baseURL: controlPlane,
        params: { viewer },
      } as never,
    ) as unknown as {
      on(event: "message", listener: (message: unknown) => void): void;
      on(event: "close", listener: () => void): void;
      close(): void;
    };
    socket.on("message", (raw) => {
      const message = ServerMessage.parse(raw);
      if (message.type === "snapshot") {
        shown.current = message.actions;
        setActions(message.actions);
        setLive("connected");
        return;
      }
      const action = message.action;
      const before = shown.current.find((a) => a.id === action.id);
      shown.current = [action, ...shown.current.filter((a) => a.id !== action.id)].sort(
        (a, b) => b.startedAt - a.startedAt,
      );
      setActions(shown.current);
      // Not for an action that changed who's signed in: the app moves on from that page itself.
      if (action.state !== "running" && before?.state !== action.state && !action.changesSession)
        void refresh();
    });
    socket.on("close", () => setLive("reconnecting"));
    return () => socket.close();
  }, [controlPlane, viewer]);

  // Open, it's a column down the right-hand side: on a wide screen the page moves over for it, so it
  // never covers what's there; on a phone it's over the page until closed.
  useEffect(() => {
    const root = document.documentElement;
    const wide = window.matchMedia("(min-width: 64rem)");
    const place = () => {
      root.style.paddingRight = open && wide.matches ? "24rem" : "";
    };
    place();
    wide.addEventListener("change", place);
    return () => {
      wide.removeEventListener("change", place);
      root.style.paddingRight = "";
    };
  }, [open]);

  const failed = actions.filter((a) => a.state === "failed").length;
  const running = actions.filter((a) => a.state === "running").length;
  return (
    <aside
      aria-label="Activity"
      data-live={live}
      className={
        open
          ? "fixed top-0 right-0 z-50 flex h-svh w-[min(24rem,100vw)] flex-col gap-2 border-l bg-background p-3"
          : "fixed right-3 bottom-3 z-50"
      }
    >
      {open && (
        <ol
          role="log"
          aria-label="Activity"
          className="w-full flex-1 overflow-y-auto rounded-lg border bg-card text-sm"
        >
          {actions.length === 0 && (
            <li className="p-3 text-muted-foreground">Nothing yet. What you do shows here.</li>
          )}
          {actions.map((action) => (
            <li
              key={action.id}
              data-action={action.id}
              data-title={action.title}
              data-by={action.by ?? ""}
              data-state={action.state}
              className="border-b p-3 last:border-b-0"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">
                  {action.title}
                  {action.by && (
                    <span className="font-normal text-muted-foreground"> by {action.by}</span>
                  )}
                </span>
                <span
                  className={
                    action.state === "failed"
                      ? "text-destructive"
                      : action.state === "running"
                        ? "text-muted-foreground"
                        : ""
                  }
                >
                  {STATE_WORDS[action.state]}
                </span>
              </div>
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {action.steps.map((step) => (
                  <li key={step.id} data-step={step.name} data-state={step.status}>
                    <span className={step.status === "failed" ? "text-destructive" : ""}>
                      {step.name} ({step.app}): {step.status}
                      {step.error && `: ${step.error}`}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        className="flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-sm shadow"
      >
        <span
          aria-hidden
          className={`size-2 rounded-full ${live === "connected" ? "bg-green-600" : "bg-amber-500"}`}
        />
        Activity
        {running > 0 && <span className="text-muted-foreground">{running} running</span>}
        {failed > 0 && <span className="text-destructive">{failed} failed</span>}
        <span className="sr-only">{live === "connected" ? "Live" : "Reconnecting"}</span>
      </button>
    </aside>
  );
}

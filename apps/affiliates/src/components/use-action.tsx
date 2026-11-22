// A button's call to one of the page's actions (Void's action()): busy while it runs, and a line
// saying how it went. Void re-runs the page's loader after an action, so the page's data comes back
// by itself.
import { useState } from "react";
import { messageOf } from "@/format";

/** An action's answer: { ok: false, error } when it was refused (Void's action()). */
function failure(result: unknown): string | null {
  if (typeof result !== "object" || result === null || !("ok" in result) || result.ok) return null;
  return "error" in result ? messageOf(result.error) : "That didn't work.";
}

export function useAction() {
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(call: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setMessage(null);
    try {
      const refused = failure(await call());
      if (refused) setMessage({ text: refused, error: true });
      else if (done) setMessage({ text: done, error: false });
    } catch (err) {
      setMessage({ text: messageOf(err), error: true });
    } finally {
      setBusy(false);
    }
  }
  const feedback = message ? (
    <p className={message.error ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
      {message.text}
    </p>
  ) : null;
  return { run, busy, feedback };
}

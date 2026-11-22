// Viewing the program as another user: Better Auth's admin plugin on the host does it, through the
// host's routes (apps/shop/routes/api/view-as/). These post there as the browser itself, so the
// host's session cookie changes and the browser comes back here.
import { Button } from "@/components/ui/button";

/** Post a form to the host and follow its redirect. */
export function postToHost(hostUrl: string, path: string, fields: Record<string, string> = {}) {
  const form = document.createElement("form");
  form.method = "post";
  form.action = new URL(path, hostUrl).toString();
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

/** The bar shown while an admin views as someone, with the way back: a plain form, so it works
 * before the page's scripts load. */
export function ViewingAsBar({ name, hostUrl }: { name: string; hostUrl: string }) {
  return (
    <div className="bg-primary text-primary-foreground">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm sm:px-6">
        <span>Viewing as {name}</span>
        <form method="post" action={new URL("/api/view-as/stop", hostUrl).toString()}>
          <Button type="submit" size="sm" variant="secondary">
            Back to admin
          </Button>
        </form>
      </div>
    </div>
  );
}

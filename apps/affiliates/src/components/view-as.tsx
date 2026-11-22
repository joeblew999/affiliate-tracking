// "View as": an admin sees the program as a partner (Better Auth's admin plugin, impersonation),
// until "Back to admin".
import { auth } from "../auth-client.ts";
import { Button } from "./ui/button.tsx";

export async function viewAs(userId: string) {
  const result = await auth.admin.impersonateUser({ userId });
  if (result.error) throw new Error(result.error.message ?? "View as failed");
  window.location.href = "/";
}

/** The bar shown while an admin views as someone, with the way back. */
export function ViewingAsBar({ name }: { name: string }) {
  return (
    <div className="bg-primary text-primary-foreground">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm sm:px-6">
        <span>Viewing as {name}</span>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            void auth.admin.stopImpersonating().then(() => {
              window.location.href = "/admin";
            })
          }
        >
          Back to admin
        </Button>
      </div>
    </div>
  );
}

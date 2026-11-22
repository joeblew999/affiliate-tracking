// The bar at the top of every page: the program's name, where you are, who's signed in.
import type { ReactNode } from "react";
import { ViewingAsBar } from "./view-as";

export function AppHeader({
  email,
  shopUrl,
  viewingAs,
  children,
}: {
  email?: string | null;
  shopUrl: string;
  /** The name of the user an admin is viewing as, if they are. */
  viewingAs?: string | null;
  /** Links shown beside the email, such as Admin. */
  children?: ReactNode;
}) {
  return (
    <>
      {viewingAs && <ViewingAsBar name={viewingAs} />}
      <header className="border-b bg-card">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <a href="/" className="font-semibold">
            Partner program
          </a>
          <nav className="flex items-center gap-4 text-sm text-muted-foreground">
            {children}
            {email && <span className="hidden truncate sm:inline">{email}</span>}
            <a className="hover:text-foreground" href={shopUrl}>
              Shop
            </a>
          </nav>
        </div>
      </header>
    </>
  );
}

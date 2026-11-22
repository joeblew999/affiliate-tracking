// The bar at the top of every page: the program's name, where you are, who's signed in.
import type { ReactNode } from "react";

export function AppHeader({
  email,
  shopUrl,
  children,
}: {
  email?: string | null;
  shopUrl: string;
  /** Links shown beside the email, such as Admin. */
  children?: ReactNode;
}) {
  return (
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
  );
}

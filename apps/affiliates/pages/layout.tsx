// Every page: the bar at the top (the program's name, the way between the partner and admin pages,
// who's signed in, the shop), from the shared data middleware/01.user.ts sets.
import "./style.css";
import { useShared } from "@void/react";
import type { ReactNode } from "react";
import { ViewingAsBar } from "@/components/view-as";

export default function Layout({ children }: { children: ReactNode }) {
  const { shopUrl, user } = useShared();
  return (
    <div className="min-h-svh bg-muted/40">
      {user?.viewingAs && <ViewingAsBar name={user.viewingAs} />}
      <header className="border-b bg-card">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <a href="/" className="font-semibold">
            Partner program
          </a>
          <nav className="flex items-center gap-4 text-sm text-muted-foreground">
            {user?.isAdmin && !user.viewingAs && (
              <>
                <a className="hover:text-foreground" href="/">
                  Partner page
                </a>
                <a className="hover:text-foreground" href="/admin">
                  Admin
                </a>
              </>
            )}
            {user && <span className="hidden truncate sm:inline">{user.email}</span>}
            <a className="hover:text-foreground" href={shopUrl}>
              Shop
            </a>
          </nav>
        </div>
      </header>
      {children}
    </div>
  );
}

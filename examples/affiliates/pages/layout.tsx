// Every page: the bar at the top (the program's name, the way between the partner and admin pages,
// who's signed in, the shop), from the shared data middleware/01.user.ts sets.
import "./style.css";
import { Link, useShared } from "@void/react";
import type { ReactNode } from "react";
import { ActivityPane } from "activity/pane";
import { ViewingAsBar } from "../src/components/view-as.tsx";

// Void marks the link to the current page with data-void-active.
const navLink =
  "hover:text-foreground data-void-active:font-medium data-void-active:text-foreground";

export default function Layout({ children }: { children: ReactNode }) {
  const { shopUrl, user, viewer, activity } = useShared();
  return (
    <div className="min-h-svh bg-muted/40">
      {user?.viewingAs && <ViewingAsBar name={user.viewingAs} />}
      <header className="border-b bg-card">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" className="font-semibold">
            Partner program
          </Link>
          <nav className="flex items-center gap-4 text-sm text-muted-foreground">
            {user?.isAdmin && !user.viewingAs && (
              <>
                <Link className={navLink} href="/">
                  Partner page
                </Link>
                <Link className={navLink} href="/admin">
                  Admin
                </Link>
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
      {viewer && <ActivityPane viewer={viewer} initial={activity} />}
    </div>
  );
}

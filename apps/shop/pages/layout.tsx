import "./style.css";
import { useShared } from "@void/react";
import type { ReactNode } from "react";
import { ActivityPane } from "activity/pane";

export default function Layout({ children }: { children: ReactNode }) {
  const { viewer, activity } = useShared();
  return (
    <>
      {children}
      {viewer && <ActivityPane viewer={viewer} initial={activity} />}
    </>
  );
}

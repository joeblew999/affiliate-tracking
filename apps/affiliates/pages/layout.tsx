import "./style.css";
import type { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
  return <main className="mx-auto max-w-5xl p-6">{children}</main>;
}

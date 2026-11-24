// A page that failed, shown in place of it.
import { Link, type ErrorPageProps } from "@void/react";

export default function ErrorPage({ error }: ErrorPageProps) {
  return (
    <main className="flex min-h-svh items-center justify-center px-4 text-center">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">{error.message}</h1>
        <Link className="text-sm underline" href="/">
          Back to the shop
        </Link>
      </div>
    </main>
  );
}

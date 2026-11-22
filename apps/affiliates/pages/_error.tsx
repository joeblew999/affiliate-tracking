// A page that failed or isn't allowed (e.g. /admin for someone who isn't an admin: 403), shown inside
// the layout, so its header and "Back to admin" bar stay.
import { Link, type ErrorPageProps } from "@void/react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function ErrorPage({ error }: ErrorPageProps) {
  return (
    <main className="mx-auto max-w-lg px-4 py-6">
      <Card>
        <CardHeader>
          <CardTitle>{error.message}</CardTitle>
          <CardDescription>
            <Link className="underline" href="/">
              Your partner page
            </Link>
          </CardDescription>
        </CardHeader>
      </Card>
    </main>
  );
}

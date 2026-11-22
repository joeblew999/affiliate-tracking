import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Props } from "./index.server";

export default function Home({ user }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Affiliate program</CardTitle>
        <CardDescription>
          {user
            ? `Signed in as ${user.email}`
            : "Sign in on the shop to see your affiliate dashboard."}
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

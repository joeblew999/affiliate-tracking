// The example shop: sign up, sign in and out with the shop's own Better Auth (void/client). The
// affiliate program is its own app on its own address; it sees this sign-in.
import { useState, type FormEvent } from "react";
import { DEMO_PASSWORD } from "affiliates/demo";
import { auth } from "@/auth-client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Props } from "./index.server";

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export default function Shop({ user, affiliatesUrl }: Props) {
  return (
    <main className="flex min-h-svh items-start justify-center bg-muted/40 px-4 py-10 sm:items-center">
      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-center text-2xl font-semibold">Example shop</h1>
        {user ? (
          <Account user={user} affiliatesUrl={affiliatesUrl} />
        ) : (
          <>
            <Demo affiliatesUrl={affiliatesUrl} />
            <SignIn />
          </>
        )}
      </div>
    </main>
  );
}

function Account({
  user,
  affiliatesUrl,
}: {
  user: NonNullable<Props["user"]>;
  affiliatesUrl: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{user.name || "Signed in"}</CardTitle>
        <CardDescription>{user.email}</CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Recommend the shop and earn commission on the sales you bring.
      </CardContent>
      <CardFooter className="flex flex-col gap-2 sm:flex-row">
        <Button
          className="w-full sm:flex-1"
          nativeButton={false}
          render={<a href={affiliatesUrl} />}
        >
          Partner program
        </Button>
        {user.isAdmin && (
          <Button
            variant="outline"
            className="w-full sm:w-auto"
            nativeButton={false}
            render={<a href={new URL("/admin", affiliatesUrl).toString()} />}
          >
            Admin
          </Button>
        )}
        <Button
          variant="outline"
          className="w-full sm:w-auto"
          onClick={() => void auth.signOut().then(() => window.location.reload())}
        >
          Sign out
        </Button>
      </CardFooter>
    </Card>
  );
}

/** The demo accounts (affiliates/demo, loaded by `vp run demo`), one tap each. */
const demoAccounts = [
  { label: "Sign in as the admin", email: "admin@demo.test", path: "/admin" },
  { label: "Sign in as Maya, a partner", email: "maya@demo.test", path: "/" },
];

function Demo({ affiliatesUrl }: { affiliatesUrl: string }) {
  const [busy, setBusy] = useState(false);
  async function signInAs(email: string, path: string) {
    setBusy(true);
    const result = await auth.signIn.email({ email, password: DEMO_PASSWORD });
    if (result.error) {
      setBusy(false);
      return;
    }
    // Signing in for the partner program: Better Auth's client follows the answer back there itself.
    if (!Reflect.get(result.data ?? {}, "redirect"))
      window.location.href = new URL(path, affiliatesUrl).toString();
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Try the partner program</CardTitle>
        <CardDescription>
          This is an example shop with an affiliate program. Partners share links and earn
          commission on the sales they bring; the admin approves partners, sets commission and pays
          them. See it as either:
        </CardDescription>
      </CardHeader>
      <CardFooter className="flex flex-col gap-2">
        {demoAccounts.map((a) => (
          <Button
            key={a.email}
            className="w-full"
            variant="outline"
            disabled={busy}
            onClick={() => void signInAs(a.email, a.path)}
          >
            {a.label}
          </Button>
        ))}
      </CardFooter>
    </Card>
  );
}

function SignIn() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>, mode: "up" | "in") {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = text(form, "email");
    const password = text(form, "password");
    setBusy(true);
    setError("");
    const result =
      mode === "up"
        ? await auth.signUp.email({ email, password, name: text(form, "name") || email })
        : await auth.signIn.email({ email, password });
    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? "That didn't work. Try again.");
      return;
    }
    // Signing in for the partner program: Better Auth's client follows the answer back there itself.
    if (!Reflect.get(result.data ?? {}, "redirect")) window.location.reload();
  }

  return (
    <Card>
      <CardContent>
        <Tabs defaultValue="in">
          <TabsList className="mb-4 w-full">
            <TabsTrigger value="in">Sign in</TabsTrigger>
            <TabsTrigger value="up">Create account</TabsTrigger>
          </TabsList>
          <TabsContent value="in">
            <form method="post" onSubmit={(e) => void submit(e, "in")} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="in-email">Email</Label>
                <Input id="in-email" name="email" type="email" autoComplete="email" required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="in-password">Password</Label>
                <Input
                  id="in-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </div>
              <Button type="submit" disabled={busy}>
                Sign in
              </Button>
            </form>
          </TabsContent>
          <TabsContent value="up">
            <form method="post" onSubmit={(e) => void submit(e, "up")} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="up-name">Name</Label>
                <Input id="up-name" name="name" autoComplete="name" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="up-email">Email</Label>
                <Input id="up-email" name="email" type="email" autoComplete="email" required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="up-password">Password</Label>
                <Input
                  id="up-password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </div>
              <Button type="submit" disabled={busy}>
                Create account
              </Button>
            </form>
          </TabsContent>
        </Tabs>
        {error && (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

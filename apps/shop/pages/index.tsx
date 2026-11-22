// The example shop: sign up, sign in and out with the shop's own Better Auth (void/client). The
// affiliate program is its own app on its own address; it sees this sign-in.
import { action, Form, useForm } from "@void/react";
import { bind } from "affiliates/bind";
import { useState, type ReactNode } from "react";
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
import { demoAccounts } from "@/demo-accounts";
import type { Props } from "./index.server";

export default function Shop({ user, affiliatesUrl, back }: Props) {
  return (
    <main className="flex min-h-svh items-start justify-center bg-muted/40 px-4 py-10 sm:items-center">
      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-center text-2xl font-semibold">Example shop</h1>
        {user ? (
          <Account user={user} affiliatesUrl={affiliatesUrl} />
        ) : (
          <>
            <Demo back={back} />
            <SignIn back={back} />
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
          onClick={() => void action("/?signOut")}
        >
          Sign out
        </Button>
      </CardFooter>
    </Card>
  );
}

function Demo({ back }: { back: string | null }) {
  const [busy, setBusy] = useState(false);
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
            onClick={() => {
              setBusy(true);
              void action("/?demo", { data: { email: a.email, back } }).finally(() =>
                setBusy(false),
              );
            }}
          >
            {a.label}
          </Button>
        ))}
      </CardFooter>
    </Card>
  );
}

function SignIn({ back }: { back: string | null }) {
  const signIn = useForm("/?signIn", { email: "", password: "", back }, { throwOnError: false });
  const signUp = useForm(
    "/?signUp",
    { name: "", email: "", password: "", back },
    { throwOnError: false },
  );
  return (
    <Card>
      <CardContent>
        <Tabs defaultValue="in">
          <TabsList className="mb-4 w-full">
            <TabsTrigger value="in">Sign in</TabsTrigger>
            <TabsTrigger value="up">Create account</TabsTrigger>
          </TabsList>
          <TabsContent value="in">
            <Form form={signIn} className="grid gap-4">
              <Field label="Email" id="in-email">
                <Input
                  id="in-email"
                  type="email"
                  autoComplete="email"
                  required
                  {...bind(signIn, "email")}
                />
              </Field>
              <Field label="Password" id="in-password">
                <Input
                  id="in-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  {...bind(signIn, "password")}
                />
              </Field>
              <Button type="submit" disabled={signIn.pending}>
                Sign in
              </Button>
            </Form>
          </TabsContent>
          <TabsContent value="up">
            <Form form={signUp} className="grid gap-4">
              <Field label="Name" id="up-name">
                <Input id="up-name" autoComplete="name" {...bind(signUp, "name")} />
              </Field>
              <Field label="Email" id="up-email">
                <Input
                  id="up-email"
                  type="email"
                  autoComplete="email"
                  required
                  {...bind(signUp, "email")}
                />
              </Field>
              <Field label="Password" id="up-password">
                <Input
                  id="up-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  {...bind(signUp, "password")}
                />
              </Field>
              <Button type="submit" disabled={signUp.pending}>
                Create account
              </Button>
            </Form>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

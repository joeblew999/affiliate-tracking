// The hub's console (index.server.ts): sign in, then an organization's streams, subscriptions
// and keys.
import { action, Form, Link, useForm } from "@void/react";
import { useState, type ReactNode } from "react";
import { bind } from "../src/components/bind.ts";
import { Badge } from "../src/components/ui/badge.tsx";
import { Button } from "../src/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../src/components/ui/card.tsx";
import { Input } from "../src/components/ui/input.tsx";
import { Label } from "../src/components/ui/label.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../src/components/ui/table.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../src/components/ui/tabs.tsx";
import type { Props } from "./index.server.ts";

const when = (ms: number | null) =>
  ms === null
    ? "never"
    : new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(ms);

export default function Console(props: Props) {
  if (!props.user) return <SignIn />;
  const { user, organizations, organization } = props;
  return (
    <div className="grid gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Durable Streams</h1>
          <p className="text-sm text-muted-foreground">{user.email}</p>
        </div>
        <Button variant="outline" onClick={() => void action("/?signOut")}>
          Sign out
        </Button>
      </header>
      <nav className="flex flex-wrap items-center gap-2">
        {organizations.map((one) => (
          <Link key={one.id} href={`/?org=${one.slug}`}>
            <Badge variant={one.id === organization?.id ? "default" : "outline"}>{one.name}</Badge>
          </Link>
        ))}
        <NewOrganization />
      </nav>
      {organization ? (
        <Organization organization={organization} />
      ) : (
        <p className="text-sm text-muted-foreground">
          No organization yet. Make one: its streams and keys are its own.
        </p>
      )}
    </div>
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

function SignIn() {
  const signIn = useForm("/?signIn", { email: "", password: "" }, { throwOnError: false });
  const signUp = useForm("/?signUp", { email: "", password: "" }, { throwOnError: false });
  return (
    <Card className="mx-auto mt-16 max-w-sm">
      <CardHeader>
        <CardTitle>Durable Streams</CardTitle>
        <CardDescription>This hub's console, for its admins.</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="in">
          <TabsList className="mb-4 w-full">
            <TabsTrigger value="in">Sign in</TabsTrigger>
            <TabsTrigger value="up">First time</TabsTrigger>
          </TabsList>
          {[
            { value: "in", form: signIn, button: "Sign in" },
            { value: "up", form: signUp, button: "Set my password" },
          ].map(({ value, form, button }) => (
            <TabsContent key={value} value={value}>
              <Form form={form} className="grid gap-4">
                <Field label="Email" id={`${value}-email`}>
                  <Input id={`${value}-email`} type="email" required {...bind(form, "email")} />
                </Field>
                <Field label="Password" id={`${value}-password`}>
                  <Input
                    id={`${value}-password`}
                    type="password"
                    required
                    {...bind(form, "password")}
                  />
                </Field>
                {form.error && <p className="text-sm text-destructive">{form.error.message}</p>}
                <Button type="submit" disabled={form.pending}>
                  {button}
                </Button>
              </Form>
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}

function NewOrganization() {
  const form = useForm("/?createOrganization", { name: "" }, { throwOnError: false });
  return (
    <Form form={form} className="flex items-center gap-2">
      <Input
        aria-label="New organization"
        placeholder="New organization"
        className="h-8 w-44"
        required
        {...bind(form, "name")}
      />
      <Button type="submit" size="sm" variant="outline" disabled={form.pending}>
        Add
      </Button>
      {form.error && <span className="text-sm text-destructive">{form.error.message}</span>}
    </Form>
  );
}

type Org = NonNullable<Extract<Props, { organization: unknown }>["organization"]>;

function Organization({ organization }: { organization: Org }) {
  const { streams, subscriptions, keys } = organization;
  return (
    <Tabs defaultValue="streams">
      <TabsList>
        <TabsTrigger value="streams">Streams ({streams.length})</TabsTrigger>
        <TabsTrigger value="subscriptions">Followers ({subscriptions.length})</TabsTrigger>
        <TabsTrigger value="keys">Keys ({keys.length})</TabsTrigger>
      </TabsList>
      <TabsContent value="streams">
        <Card>
          <CardHeader>
            <CardTitle>Streams</CardTitle>
            <CardDescription>What this organization's Workers have written.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Stream</TableHead>
                  <TableHead>Events</TableHead>
                  <TableHead>Followed by</TableHead>
                  <TableHead>Made</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {streams.map((stream) => (
                  <TableRow key={stream.name}>
                    <TableCell>
                      <Link
                        className="font-medium underline-offset-4 hover:underline"
                        href={`/stream?org=${organization.slug}&name=${encodeURIComponent(stream.name)}`}
                      >
                        {stream.name}
                      </Link>{" "}
                      {stream.closed && <Badge variant="outline">closed</Badge>}
                    </TableCell>
                    <TableCell>{stream.messages}</TableCell>
                    <TableCell>
                      {subscriptions
                        .filter((sub) => sub.streams.some((s) => s.path === stream.name))
                        .map((sub) => sub.id)
                        .join(", ") || "nobody"}
                    </TableCell>
                    <TableCell>{when(stream.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>
      <TabsContent value="subscriptions">
        <Card>
          <CardHeader>
            <CardTitle>Followers</CardTitle>
            <CardDescription>
              Who follows which stream, and whether each has caught up with it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Follower</TableHead>
                  <TableHead>How</TableHead>
                  <TableHead>Follows</TableHead>
                  <TableHead>State</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subscriptions.map((sub) => (
                  <TableRow key={sub.id}>
                    <TableCell>
                      <div className="font-medium">{sub.id}</div>
                      <div className="text-xs text-muted-foreground">{sub.description}</div>
                    </TableCell>
                    <TableCell>
                      <div>{sub.type}</div>
                      <div className="max-w-60 truncate text-xs text-muted-foreground">
                        {sub.to}
                      </div>
                    </TableCell>
                    <TableCell>{sub.streams.map((s) => s.path).join(", ")}</TableCell>
                    <TableCell>
                      {sub.failed ? (
                        <Badge variant="destructive">failing</Badge>
                      ) : sub.streams.some((s) => s.behind) ? (
                        <Badge variant="outline">behind</Badge>
                      ) : (
                        <Badge variant="secondary">caught up</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>
      <TabsContent value="keys">
        <Keys organization={organization} />
      </TabsContent>
    </Tabs>
  );
}

function Keys({ organization }: { organization: Org }) {
  const [name, setName] = useState("");
  const [made, setMade] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function create() {
    setError(null);
    const response = await fetch("/console/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organization: organization.id, name }),
    });
    if (!response.ok) return setError(await response.text());
    setMade(((await response.json()) as { key: string }).key);
    setName("");
    // The list, with the new key in it.
    await action("/?refresh").catch(() => location.reload());
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Keys</CardTitle>
        <CardDescription>
          One per Worker. A Worker sends its key with every call: Authorization: Bearer …
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <Input
            aria-label="New key's name"
            placeholder="The Worker it's for"
            className="w-64"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Button type="submit">Make a key</Button>
        </form>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {made && (
          <div className="rounded-lg border p-3 text-sm">
            <p className="mb-1 font-medium">Copy it now: it isn't shown again.</p>
            <code className="break-all">{made}</code>
          </div>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Starts</TableHead>
              <TableHead>Made</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {organization.keys.map((key) => (
              <TableRow key={key.id}>
                <TableCell className="font-medium">{key.name}</TableCell>
                <TableCell>
                  <code>{key.start}…</code>
                </TableCell>
                <TableCell>{when(key.createdAt)}</TableCell>
                <TableCell>{when(key.lastRequest)}</TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void action("/?revokeKey", { data: { id: key.id } })}
                  >
                    Revoke
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

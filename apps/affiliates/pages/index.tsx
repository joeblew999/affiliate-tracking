// The partner's page. Signed out: sign in on the shop. Signed in: apply; then wait for approval;
// then the dashboard: their link and buyer code, totals, short links, and the last 30 days.
import { useRouter } from "@void/react";
import { useState, type FormEvent, type ReactNode } from "react";
import { fetch } from "void/client";
import { AppHeader } from "@/components/app-header";
import { ClicksChart, TopList } from "@/components/clicks-chart";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { messageOf, money } from "@/format";
import type { Props } from "./index.server";

function useAction() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await router.refresh();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }
  return { run, error, busy };
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export default function PartnerPage(props: Props) {
  const { user, partner } = props;
  return (
    <>
      <AppHeader email={user?.email} shopUrl={props.shopUrl}>
        {user?.isAdmin && (
          <a className="hover:text-foreground" href="/admin">
            Admin
          </a>
        )}
      </AppHeader>
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
        {!user && (
          <Notice
            title="Partner program"
            text="Recommend the shop and earn commission on every sale your link brings. Sign in on the shop first, then come back here to apply."
          >
            <Button nativeButton={false} render={<a href={props.shopUrl} />}>
              Sign in on the shop
            </Button>
          </Notice>
        )}
        {user && !partner && <Apply />}
        {partner?.status === "pending" && (
          <Notice title="Application received" text="An admin will review it soon." />
        )}
        {partner?.status === "suspended" && (
          <Notice title="Suspended" text="Your partner account is suspended. Contact the shop." />
        )}
        {partner?.status === "active" && <Dashboard {...props} />}
      </main>
    </>
  );
}

function Notice({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{text}</CardDescription>
      </CardHeader>
      {children && <CardContent>{children}</CardContent>}
    </Card>
  );
}

function Apply() {
  const { run, error, busy } = useAction();
  const [terms, setTerms] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(() =>
      fetch("/api/partner/apply", {
        method: "POST",
        body: {
          name: field(form, "name"),
          application: field(form, "application") || undefined,
          acceptTerms: true,
        },
      }),
    );
  }
  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader>
        <CardTitle>Become a partner</CardTitle>
        <CardDescription>
          Share your link and earn commission on every sale it brings.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" required maxLength={100} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="application">How will you promote us?</Label>
            <Textarea id="application" name="application" maxLength={2000} />
          </div>
          <Label className="flex items-center gap-2 font-normal">
            <Checkbox checked={terms} onCheckedChange={(checked) => setTerms(checked === true)} />I
            accept the partner terms
          </Label>
          <Button type="submit" disabled={!terms || busy}>
            Apply
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>
      </CardContent>
    </Card>
  );
}

function Dashboard({ partner, links, stats, earnings, program }: Props) {
  const { run, error, busy } = useAction();
  if (!partner || !stats) return null;
  const funnel = stats.funnel[0];
  const totals = earnings.length
    ? earnings
    : [{ currency: "usd", onHoldCents: 0, readyCents: 0, paidCents: 0 }];
  const sum = (key: "onHoldCents" | "readyCents" | "paidCents") =>
    totals.map((m) => money(m[key], m.currency)).join(" + ");
  function createLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const formEl = event.currentTarget;
    void run(async () => {
      await fetch("/api/partner/links", {
        method: "POST",
        body: {
          destination: field(form, "destination") || "/",
          campaign: field(form, "campaign") || null,
          slug: field(form, "slug").toLowerCase() || null,
        },
      });
      formEl.reset();
    });
  }
  const activeLinks = links.filter((link) => link.status === "active");
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Your link</CardTitle>
          <CardDescription>
            {partner.commissionPct}% commission on every sale it brings
            {partner.promoCode && <>. Buyers can also use your code {partner.promoCode}</>}.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <code className="min-w-0 flex-1 rounded-md bg-muted px-3 py-2 text-sm break-all">
            {partner.link}
          </code>
          <CopyButton value={partner.link} />
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          title="On hold"
          value={sum("onHoldCents")}
          note={
            program.holdDays
              ? `Approved ${program.holdDays} days after each sale`
              : "Waiting for approval"
          }
        />
        <Stat title="Ready to pay" value={sum("readyCents")} note="Paid with the next payout">
          {!partner.paidOut && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const { url } = await fetch("/api/partner/connect", { method: "POST" });
                  window.location.href = url;
                })
              }
            >
              Set up payouts
            </Button>
          )}
        </Stat>
        <Stat title="Paid" value={sum("paidCents")} note="All time" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Last 30 days</CardTitle>
          <CardDescription>
            {funnel?.clicks ?? 0} clicks, {funnel?.signups ?? 0} signups, {funnel?.sales ?? 0} sales
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <ClicksChart days={stats.clicksByDay} />
          <div className="grid gap-6 sm:grid-cols-3">
            <TopList title="Countries" rows={stats.topCountries} />
            <TopList title="Devices" rows={stats.topDevices} />
            <TopList title="Referring sites" rows={stats.topReferrers} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Short links</CardTitle>
          <CardDescription>
            Links to any page of the shop, each with its own clicks and sales.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={createLink} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
            <Input name="destination" placeholder="Page, e.g. /pricing" aria-label="Goes to" />
            <Input name="campaign" placeholder="Campaign" aria-label="Campaign" />
            <Input name="slug" placeholder="Short name (optional)" aria-label="Short name" />
            <Button type="submit" disabled={busy}>
              Create link
            </Button>
          </form>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {activeLinks.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Link</TableHead>
                  <TableHead className="hidden sm:table-cell">Campaign</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Clicks</TableHead>
                  <TableHead className="text-right">Sales</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeLinks.map((link) => (
                  <TableRow key={link.id}>
                    <TableCell className="max-w-[14rem] sm:max-w-none">
                      <div className="truncate font-medium">{link.url}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        to {link.destination}
                        <span className="sm:hidden"> · {link.campaign ?? "no campaign"}</span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">{link.campaign ?? "—"}</TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">
                      {link.clicks}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{link.sales}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <CopyButton value={link.url} variant="ghost" />
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            fetch("/api/partner/links/archive", {
                              method: "POST",
                              body: { id: link.id },
                            }),
                          )
                        }
                      >
                        Archive
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function Stat({
  title,
  value,
  note,
  children,
}: {
  title: string;
  value: string;
  note: string;
  children?: ReactNode;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        {note}
        {children}
      </CardContent>
    </Card>
  );
}

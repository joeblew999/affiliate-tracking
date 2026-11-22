// The partner's page. Signed out: sign in on the shop. Signed in: apply; then wait for approval;
// then the dashboard: their link and buyer code, totals, short links, and the last 30 days.
import { useRouter } from "@void/react";
import { useState, type FormEvent } from "react";
import { fetch } from "void/client";
import { ClicksChart, TopList } from "@/components/clicks-chart";
import { Badge } from "@/components/ui/badge";
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
  if (!user) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Affiliate program</CardTitle>
          <CardDescription>
            Sign in on{" "}
            <a className="underline" href={props.shopUrl}>
              the shop
            </a>{" "}
            first, then come back here.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }
  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Affiliate program</h1>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          {user.email}
          {user.isAdmin && (
            <a className="underline" href="/admin">
              Admin
            </a>
          )}
        </div>
      </header>
      {!partner && <Apply />}
      {partner?.status === "pending" && (
        <Notice title="Application received" text="An admin will review it soon." />
      )}
      {partner?.status === "suspended" && (
        <Notice title="Suspended" text="Your partner account is suspended. Contact the shop." />
      )}
      {partner?.status === "active" && <Dashboard {...props} />}
    </div>
  );
}

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{text}</CardDescription>
      </CardHeader>
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
    <Card>
      <CardHeader>
        <CardTitle>Become a partner</CardTitle>
        <CardDescription>Share your link; earn commission on every sale it brings.</CardDescription>
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

function Dashboard({ partner, links, stats }: Props) {
  const { run, error, busy } = useAction();
  if (!partner || !stats) return null;
  const funnel = stats.funnel[0];
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
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{partner.name}</CardTitle>
          <CardDescription>
            Your link: <code>{partner.link}</code> · {partner.commissionPct}% commission
            {partner.promoCode && (
              <>
                {" "}
                · buyer code <code>{partner.promoCode}</code>
              </>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-6 text-sm">
          <span>{funnel?.clicks ?? 0} clicks</span>
          <span>{funnel?.signups ?? 0} signups</span>
          <span>{funnel?.sales ?? 0} sales</span>
          {(funnel?.money ?? []).map((m) => (
            <span key={m.currency}>
              {money(m.pendingCents + m.approvedCents, m.currency)} owed ·{" "}
              {money(m.paidCents, m.currency)} paid
            </span>
          ))}
          {!partner.paidOut && (
            <Button
              variant="outline"
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Links</CardTitle>
          <CardDescription>
            Short links to any page of the shop, each with its own clicks and sales.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={createLink} className="grid gap-2 sm:grid-cols-4">
            <Input name="destination" placeholder="/pricing" aria-label="Goes to" />
            <Input name="campaign" placeholder="Campaign" aria-label="Campaign" />
            <Input name="slug" placeholder="Short name (optional)" aria-label="Short name" />
            <Button type="submit" disabled={busy}>
              Create link
            </Button>
          </form>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Link</TableHead>
                <TableHead>Campaign</TableHead>
                <TableHead className="text-right">Clicks</TableHead>
                <TableHead className="text-right">Sales</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {links
                .filter((link) => link.status === "active")
                .map((link) => (
                  <TableRow key={link.id}>
                    <TableCell>
                      <code>{link.url}</code>
                      <div className="text-xs text-muted-foreground">to {link.destination}</div>
                    </TableCell>
                    <TableCell>{link.campaign ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{link.clicks}</TableCell>
                    <TableCell className="text-right tabular-nums">{link.sales}</TableCell>
                    <TableCell className="text-right">
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
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Last 30 days</CardTitle>
          <CardDescription>
            <Badge variant="secondary">
              {stats.clicksByDay.reduce((sum, d) => sum + d.clicks, 0)} clicks
            </Badge>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ClicksChart days={stats.clicksByDay} />
          <div className="grid gap-4 sm:grid-cols-3">
            <TopList title="Countries" rows={stats.topCountries} />
            <TopList title="Devices" rows={stats.topDevices} />
            <TopList title="Referring sites" rows={stats.topReferrers} />
          </div>
        </CardContent>
      </Card>
    </>
  );
}

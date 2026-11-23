// The partner's page (signed out: the shop's sign-in first, middleware/01.user.ts). Signed in: apply; then wait for approval;
// then the dashboard: their link and buyer code, totals, short links, and the last 30 days.
import { action, Form, useForm } from "@void/react";
import { useState, type ReactNode } from "react";
import { ClicksChart, TopList } from "../src/components/clicks-chart.tsx";
import { CopyButton } from "../src/components/copy-button.tsx";
import { Button } from "../src/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../src/components/ui/card.tsx";
import { Checkbox } from "../src/components/ui/checkbox.tsx";
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
import { Textarea } from "../src/components/ui/textarea.tsx";
import { money } from "../src/format.ts";
import { bind } from "../src/components/bind.ts";
import { useAction } from "../src/components/use-action.tsx";
import type { Props } from "./index.server.ts";

export default function PartnerPage(props: Props) {
  const { partner } = props;
  return (
    <>
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
        {!partner && <Apply />}
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
  const form = useForm(
    "/?apply",
    { name: "", application: "", acceptTerms: true },
    { throwOnError: false },
  );
  const [terms, setTerms] = useState(false);
  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader>
        <CardTitle>Become a partner</CardTitle>
        <CardDescription>
          Share your link and earn commission on every sale it brings.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form form={form} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" required maxLength={100} {...bind(form, "name")} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="application">How will you promote us?</Label>
            <Textarea id="application" maxLength={2000} {...bind(form, "application")} />
          </div>
          <Label className="flex items-center gap-2 font-normal">
            <Checkbox checked={terms} onCheckedChange={(checked) => setTerms(checked === true)} />I
            accept the partner terms
          </Label>
          <Button type="submit" disabled={!terms || form.pending}>
            Apply
          </Button>
        </Form>
      </CardContent>
    </Card>
  );
}

/** A new short link: empty fields are left out (a link to the home page, a made-up name). */
function NewLink() {
  const form = useForm("/?createLink", {}, { throwOnError: false, resetOnSuccess: true });
  const text = (name: "destination" | "campaign" | "slug") =>
    bind(form, name, { empty: undefined, as: (t) => (name === "slug" ? t.toLowerCase() : t) });
  return (
    <Form form={form} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
      <Input {...text("destination")} placeholder="Page, e.g. /pricing" aria-label="Goes to" />
      <Input {...text("campaign")} placeholder="Campaign" aria-label="Campaign" />
      <Input {...text("slug")} placeholder="Short name (optional)" aria-label="Short name" />
      <Button type="submit" disabled={form.pending}>
        Create link
      </Button>
    </Form>
  );
}

function Dashboard({ partner, links, stats, earnings, program, payoutCountries, country }: Props) {
  const { run, busy, feedback } = useAction();
  if (!partner || !stats) return null;
  const funnel = stats.funnel[0];
  const totals = earnings.length
    ? earnings
    : [{ currency: "usd", onHoldCents: 0, readyCents: 0, paidCents: 0 }];
  const sum = (key: "onHoldCents" | "readyCents" | "paidCents") =>
    totals.map((m) => money(m[key], m.currency)).join(" + ");
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
          {!partner.paidOut && payoutCountries.length > 0 && (
            <SetUpPayouts countries={payoutCountries} country={country} busy={busy} run={run} />
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
          <NewLink />
          {feedback}
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
                          void run(() => action("/?archiveLink", { data: { id: link.id } }))
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

/** Choose the country your Stripe account is in, then Stripe's own onboarding. */
function SetUpPayouts({
  countries,
  country,
  busy,
  run,
}: {
  countries: string[];
  country: string | null;
  busy: boolean;
  run: ReturnType<typeof useAction>["run"];
}) {
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  const sorted = [...countries].sort((a, b) => (names.of(a) ?? a).localeCompare(names.of(b) ?? b));
  const [chosen, setChosen] = useState(
    country && countries.includes(country) ? country : (sorted[0] ?? ""),
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Country your bank account is in"
        className="h-8 rounded-md border bg-background px-2 text-sm"
        value={chosen}
        onChange={(e) => setChosen(e.target.value)}
      >
        {sorted.map((code) => (
          <option key={code} value={code}>
            {names.of(code) ?? code}
          </option>
        ))}
      </select>
      <Button
        variant="outline"
        size="sm"
        disabled={busy || !chosen}
        // Its answer is a redirect to Stripe's onboarding.
        onClick={() => void run(async () => action("/?connect", { data: { country: chosen } }))}
      >
        Set up payouts
      </Button>
    </div>
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

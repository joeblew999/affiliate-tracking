// The admin page: partners (approve, suspend, settings, links), sales (approve, reject), payouts
// (run them), commission rules and bonuses, and performance.
import { useRouter } from "@void/react";
import { useState, type FormEvent, type ReactNode } from "react";
import { fetch } from "void/client";
import { MoreHorizontal } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { postToHost } from "@/components/view-as";
import { ClicksChart, TopList } from "@/components/clicks-chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { date, messageOf, minorUnits, money } from "@/format";
import type { Props } from "./index.server";

type Allowed = Extract<Props, { allowed: true }>;

function useAction() {
  const router = useRouter();
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(action: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      if (done) setMessage({ text: done, error: false });
      await router.refresh();
    } catch (err) {
      setMessage({ text: messageOf(err), error: true });
    } finally {
      setBusy(false);
    }
  }
  const feedback = message ? (
    <p className={message.error ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
      {message.text}
    </p>
  ) : null;
  return { run, busy, feedback };
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

const selectClass = "h-9 rounded-md border bg-transparent px-2 text-sm";

export default function AdminPage(props: Props) {
  if (!props.allowed) {
    return (
      <>
        <AppHeader shopUrl={props.shopUrl} viewingAs={props.viewingAs} />
        <main className="mx-auto max-w-lg px-4 py-6">
          <Card>
            <CardHeader>
              <CardTitle>Admins only</CardTitle>
              <CardDescription>
                Sign in on the shop with an admin account.{" "}
                <a className="underline" href="/">
                  Back
                </a>
              </CardDescription>
            </CardHeader>
          </Card>
        </main>
      </>
    );
  }
  const applications = props.partners.filter((p) => p.status === "pending").length;
  const toReview = props.sales.filter((s) => s.status === "pending").length;
  return (
    <>
      <AppHeader email={props.email} shopUrl={props.shopUrl}>
        <a className="hover:text-foreground" href="/">
          Partner page
        </a>
      </AppHeader>
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <Tabs defaultValue="partners">
          <TabsList className="mb-4 w-full justify-start overflow-x-auto sm:w-auto">
            <TabsTrigger value="partners">
              Partners{applications > 0 && <Badge variant="secondary">{applications} new</Badge>}
            </TabsTrigger>
            <TabsTrigger value="sales">
              Sales{toReview > 0 && <Badge variant="secondary">{toReview} pending</Badge>}
            </TabsTrigger>
            <TabsTrigger value="payouts">Payouts</TabsTrigger>
            <TabsTrigger value="rules">Rules &amp; bonuses</TabsTrigger>
            <TabsTrigger value="performance">Performance</TabsTrigger>
          </TabsList>
          <TabsContent value="partners">
            <Partners {...props} />
          </TabsContent>
          <TabsContent value="sales">
            <Sales {...props} />
          </TabsContent>
          <TabsContent value="payouts">
            <Payouts {...props} />
          </TabsContent>
          <TabsContent value="rules">
            <Rules {...props} />
          </TabsContent>
          <TabsContent value="performance">
            <Performance {...props} />
          </TabsContent>
        </Tabs>
      </main>
    </>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "active" || status === "approved" || status === "paid" || status === "sent"
      ? "default"
      : status === "refunded" ||
          status === "rejected" ||
          status === "suspended" ||
          status === "failed"
        ? "destructive"
        : "secondary";
  return <Badge variant={variant}>{status}</Badge>;
}

function Partners({ partners, shopUrl }: Allowed) {
  const { run, busy, feedback } = useAction();
  const [linksFor, setLinksFor] = useState<{
    name: string;
    links: {
      id: string;
      url: string;
      destination: string;
      campaign: string | null;
      clicks: number;
      sales: number;
      status: string;
    }[];
  } | null>(null);
  const status = (id: string, value: "active" | "suspended") =>
    run(() => fetch("/api/admin/partners/status", { method: "POST", body: { id, status: value } }));
  const update = (id: string, body: { commissionPct?: number; reviewRequired?: boolean }) =>
    run(() => fetch("/api/admin/partners/update", { method: "POST", body: { id, ...body } }));
  return (
    <Section
      title="Partners"
      description="Shop users who applied. Approving one also makes their buyer code, when a coupon is set."
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Partner</TableHead>
            <TableHead className="hidden sm:table-cell">Status</TableHead>
            <TableHead className="hidden md:table-cell">Code</TableHead>
            <TableHead className="hidden md:table-cell">Commission %</TableHead>
            <TableHead className="hidden lg:table-cell">Application</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {partners.map((p) => (
            <TableRow key={p.id}>
              <TableCell className="whitespace-normal">
                {p.name ?? "—"}
                <div className="mt-1 sm:hidden">
                  <StatusBadge status={p.status} />
                </div>
                <div className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  {p.email}
                </div>
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                <StatusBadge status={p.status} />
                {p.reviewRequired && (
                  <div className="text-xs text-muted-foreground">every sale reviewed</div>
                )}
              </TableCell>
              <TableCell className="hidden md:table-cell">{p.code}</TableCell>
              <TableCell className="hidden md:table-cell">
                <Input
                  aria-label={`Commission % for ${p.name ?? p.email}`}
                  className="w-20"
                  type="number"
                  min={0}
                  max={100}
                  defaultValue={p.commissionPct}
                  onBlur={(e) => {
                    const pct = Number(e.currentTarget.value);
                    if (pct !== p.commissionPct) void update(p.id, { commissionPct: pct });
                  }}
                />
              </TableCell>
              <TableCell className="hidden max-w-xs text-sm whitespace-normal text-muted-foreground lg:table-cell">
                {p.application ?? "—"}
              </TableCell>
              <TableCell className="space-x-1 text-right whitespace-nowrap">
                {p.status !== "active" && (
                  <Button size="sm" disabled={busy} onClick={() => void status(p.id, "active")}>
                    {p.status === "pending" ? "Approve" : "Reactivate"}
                  </Button>
                )}
                {p.status === "active" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void status(p.id, "suspended")}
                  >
                    Suspend
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button size="icon-sm" variant="ghost" aria-label={`More for ${p.email}`} />
                    }
                  >
                    <MoreHorizontal />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => postToHost(shopUrl, "/api/view-as", { userId: p.userId })}
                    >
                      View as {p.name ?? p.email}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={busy}
                      onClick={() => void update(p.id, { reviewRequired: !p.reviewRequired })}
                    >
                      {p.reviewRequired ? "Stop reviewing every sale" : "Review every sale"}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const { links } = await fetch("/api/admin/partners/links", {
                            query: { partnerId: p.id },
                          });
                          setLinksFor({ name: p.name ?? p.email, links });
                        })
                      }
                    >
                      Show links
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {feedback}
      {linksFor && (
        <div className="rounded-lg border p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-medium">Links of {linksFor.name}</h3>
            <Button size="sm" variant="ghost" onClick={() => setLinksFor(null)}>
              Close
            </Button>
          </div>
          {linksFor.links.length === 0 ? (
            <p className="text-sm text-muted-foreground">No short links yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {linksFor.links.map((l) => (
                <li key={l.id}>
                  <code>{l.url}</code> to {l.destination} · {l.campaign ?? "no campaign"} ·{" "}
                  {l.clicks} clicks · {l.sales} sales · {l.status}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Section>
  );
}

function Sales({ sales }: Allowed) {
  const { run, busy, feedback } = useAction();
  const decide = (id: string, status: "approved" | "rejected" | "pending") =>
    run(() => fetch("/api/admin/sales/status", { method: "POST", body: { id, status } }));
  return (
    <Section
      title="Sales"
      description="Latest 200. Pending sales are approved by the hold period, or here."
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="hidden sm:table-cell">Date</TableHead>
            <TableHead className="hidden sm:table-cell">Partner</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Paid</TableHead>
            <TableHead className="text-right">Commission</TableHead>
            <TableHead className="hidden sm:table-cell">Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sales.map((s) => (
            <TableRow key={s.id}>
              <TableCell className="hidden sm:table-cell">{date(s.createdAt)}</TableCell>
              <TableCell className="hidden sm:table-cell">{s.partnerName ?? "—"}</TableCell>
              <TableCell className="whitespace-normal [overflow-wrap:anywhere]">
                <div className="text-xs text-muted-foreground sm:hidden">
                  {date(s.createdAt)}, {s.partnerName ?? "—"}
                </div>
                {s.kind === "bonus" ? `Bonus: ${s.bonusNote ?? ""}` : (s.customerEmail ?? "—")}
                <div className="mt-1 sm:hidden">
                  <StatusBadge status={s.status} />
                </div>
                {s.kind === "clawback" && (
                  <div className="text-xs text-muted-foreground">
                    clawback: a refund after it was paid out
                  </div>
                )}
                {s.refundedCents > 0 && s.kind !== "clawback" && (
                  <div className="text-xs text-muted-foreground">
                    {money(s.refundedCents, s.currency)} refunded
                  </div>
                )}
                {s.kind === "renewal" && (
                  <div className="text-xs text-muted-foreground">renewal</div>
                )}
                {s.fraudReason && (
                  <div className="text-xs text-destructive">
                    {s.fraudReason === "self_email"
                      ? "Flagged: the partner's own email"
                      : "Flagged: from the partner's own IP"}
                  </div>
                )}
              </TableCell>
              <TableCell className="hidden text-right tabular-nums sm:table-cell">
                {money(s.amountCents, s.currency)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {money(s.commissionCents, s.currency)}
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                <StatusBadge status={s.status} />
              </TableCell>
              <TableCell>
                <div className="flex flex-col items-end gap-1 sm:flex-row sm:justify-end">
                  {(s.status === "pending" || s.status === "rejected") && (
                    <Button size="sm" disabled={busy} onClick={() => void decide(s.id, "approved")}>
                      Approve
                    </Button>
                  )}
                  {(s.status === "pending" || s.status === "approved") && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void decide(s.id, "rejected")}
                    >
                      Reject
                    </Button>
                  )}
                  {s.status === "approved" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void decide(s.id, "pending")}
                    >
                      Back to pending
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {feedback}
    </Section>
  );
}

function Payouts({ payouts }: Allowed) {
  const { run, busy, feedback } = useAction();
  return (
    <Section
      title="Payouts"
      description="Partners with Stripe Connect are paid by transfer; others are listed as manual, for you to pay."
    >
      <Button
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const { queued } = await fetch("/api/admin/payouts/run", { method: "POST", body: {} });
            return queued;
          }, "Payouts queued. They appear here as each finishes.")
        }
      >
        Run payouts
      </Button>
      {feedback}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Partner</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Transfer</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {payouts.map((p) => (
            <TableRow key={p.id}>
              <TableCell>{date(p.createdAt)}</TableCell>
              <TableCell>{p.partnerName ?? "—"}</TableCell>
              <TableCell className="text-right tabular-nums">
                {money(p.amountCents, p.currency)}
              </TableCell>
              <TableCell>
                <StatusBadge status={p.status} />
                {p.lastError && <div className="text-xs text-destructive">{p.lastError}</div>}
              </TableCell>
              <TableCell>
                <code className="text-xs">{p.stripeTransferId ?? "—"}</code>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Section>
  );
}

function Rules({ rules, partners, payoutCurrency }: Allowed) {
  const { run, busy, feedback } = useAction();
  const [kind, setKind] = useState<"percent" | "fixed">("percent");
  const active = partners.filter((p) => p.status === "active");
  const nameOf = (id: string | null) =>
    id === null ? "Every partner" : (partners.find((p) => p.id === id)?.name ?? id);
  function addRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const formEl = event.currentTarget;
    const common = {
      partnerId: field(form, "partnerId") || null,
      productId: field(form, "productId") || null,
      minMonthlySales: Number(field(form, "minMonthlySales") || 0),
      capPerCustomerCents: field(form, "cap")
        ? minorUnits(field(form, "cap"), field(form, "currency") || payoutCurrency)
        : null,
    };
    const body =
      kind === "percent"
        ? { kind, percent: Number(field(form, "percent")), ...common }
        : {
            kind,
            fixedCents: minorUnits(field(form, "fixed"), field(form, "currency")),
            currency: field(form, "currency").toLowerCase(),
            ...common,
          };
    void run(async () => {
      await fetch("/api/admin/rules", { method: "POST", body });
      formEl.reset();
    }, "Rule added.");
  }
  function addBonus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const formEl = event.currentTarget;
    void run(async () => {
      await fetch("/api/admin/bonus", {
        method: "POST",
        body: {
          partnerId: field(form, "partnerId"),
          amountCents: minorUnits(field(form, "amount"), payoutCurrency),
          note: field(form, "note"),
        },
      });
      formEl.reset();
    }, "Bonus added: approved, paid with the next payout.");
  }
  return (
    <div className="space-y-6">
      <Section
        title="Commission rules"
        description="Without rules each partner earns their own %. For each item the most specific rule wins: partner and product, then product, then partner, then everyone."
      >
        <form onSubmit={addRule} className="grid gap-2 sm:grid-cols-4">
          <select
            className={selectClass}
            aria-label="Pays"
            value={kind}
            onChange={(e) => setKind(e.currentTarget.value === "fixed" ? "fixed" : "percent")}
          >
            <option value="percent">A percent of the sale</option>
            <option value="fixed">A fixed amount per unit</option>
          </select>
          {kind === "percent" ? (
            <Input
              name="percent"
              type="number"
              min={0}
              max={100}
              step={0.1}
              placeholder="Percent"
              required
            />
          ) : (
            <>
              <Input name="fixed" type="number" min={0} step={0.01} placeholder="Amount" required />
              <Input name="currency" placeholder="usd" maxLength={3} required />
            </>
          )}
          <select className={selectClass} name="partnerId" aria-label="Partner">
            <option value="">Every partner</option>
            {active.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name ?? p.email}
              </option>
            ))}
          </select>
          <Input name="productId" placeholder="prod_… or price_… (empty: everything)" />
          <Input name="minMonthlySales" type="number" min={0} placeholder="From sales this month" />
          <Input name="cap" type="number" min={0} step={0.01} placeholder="Most per customer" />
          <Button type="submit" disabled={busy}>
            Add rule
          </Button>
        </form>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pays</TableHead>
              <TableHead>Partner</TableHead>
              <TableHead>Product</TableHead>
              <TableHead>From sales/month</TableHead>
              <TableHead>Most per customer</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  {r.kind === "percent"
                    ? `${r.percent}%`
                    : `${money(r.fixedCents ?? 0, r.currency ?? payoutCurrency)} per unit`}
                </TableCell>
                <TableCell>{nameOf(r.partnerId)}</TableCell>
                <TableCell>{r.productId ?? "Everything"}</TableCell>
                <TableCell>{r.minMonthlySales || "—"}</TableCell>
                <TableCell>
                  {r.capPerCustomerCents === null
                    ? "—"
                    : money(r.capPerCustomerCents, r.currency ?? payoutCurrency)}
                </TableCell>
                <TableCell>
                  <StatusBadge status={r.active ? "active" : "archived"} />
                </TableCell>
                <TableCell className="text-right">
                  {r.active && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            fetch("/api/admin/rules/archive", {
                              method: "POST",
                              body: { id: r.id },
                            }),
                          "Rule archived.",
                        )
                      }
                    >
                      Archive
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>
      <Section
        title="One-off bonus"
        description={`Approved straight away and paid with the partner's next payout, in ${payoutCurrency.toUpperCase()}.`}
      >
        <form onSubmit={addBonus} className="grid gap-2 sm:grid-cols-4">
          <select className={selectClass} name="partnerId" aria-label="Partner" required>
            {active.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name ?? p.email}
              </option>
            ))}
          </select>
          <Input name="amount" type="number" min={0.01} step={0.01} placeholder="Amount" required />
          <Input name="note" maxLength={200} placeholder="Launch week" required />
          <Button type="submit" disabled={busy || active.length === 0}>
            Add bonus
          </Button>
        </form>
      </Section>
      {feedback}
    </div>
  );
}

function Performance({ stats }: Allowed) {
  return (
    <Section title="Last 30 days">
      <ClicksChart days={stats.clicksByDay} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Partner</TableHead>
            <TableHead className="text-right">Clicks</TableHead>
            <TableHead className="text-right">Signups</TableHead>
            <TableHead className="text-right">Customers</TableHead>
            <TableHead className="text-right">Sales</TableHead>
            <TableHead className="text-right">Revenue</TableHead>
            <TableHead className="text-right">Commission owed</TableHead>
            <TableHead className="text-right">Paid</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {stats.funnel
            .filter((f) => f.clicks || f.sales || f.signups || f.money.length)
            .map((f) => (
              <TableRow key={f.partnerId}>
                <TableCell>{f.name ?? f.code}</TableCell>
                <TableCell className="text-right tabular-nums">{f.clicks}</TableCell>
                <TableCell className="text-right tabular-nums">{f.signups}</TableCell>
                <TableCell className="text-right tabular-nums">{f.customers}</TableCell>
                <TableCell className="text-right tabular-nums">{f.sales}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {f.money.map((m) => money(m.revenueCents, m.currency)).join(" + ") || "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {f.money
                    .map((m) => money(m.pendingCents + m.approvedCents, m.currency))
                    .join(" + ") || "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {f.money.map((m) => money(m.paidCents, m.currency)).join(" + ") || "—"}
                </TableCell>
              </TableRow>
            ))}
        </TableBody>
      </Table>
      <div className="grid gap-4 sm:grid-cols-3">
        <TopList title="Countries" rows={stats.topCountries} />
        <TopList title="Devices" rows={stats.topDevices} />
        <TopList title="Referring sites" rows={stats.topReferrers} />
      </div>
    </Section>
  );
}

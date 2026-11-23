// The admin page: events (book them, their money), partners (approve, suspend, settings, links),
// sales (approve, reject), payouts (run them), commission rules and bonuses, and performance.
import { action, Form, useForm, useRouter } from "@void/react";
import type { Href, ResolveActionBody } from "void/routes";
import { useState, type ComponentProps, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { viewAs } from "../../src/components/view-as.tsx";
import { ClicksChart, TopList } from "../../src/components/clicks-chart.tsx";
import { Badge } from "../../src/components/ui/badge.tsx";
import { Button } from "../../src/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../src/components/ui/card.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../src/components/ui/dropdown-menu.tsx";
import { Input } from "../../src/components/ui/input.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../src/components/ui/table.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../src/components/ui/tabs.tsx";
import { date, minorUnits, money } from "../../src/format.ts";
import { bind } from "../../src/components/bind.ts";
import { useAction } from "../../src/components/use-action.tsx";
import type { Props } from "./index.server.ts";

/** A new rule, typed as the addRule action takes it: a percent, for every partner and product. */
const NO_RULE: ResolveActionBody<"/admin?addRule"> = {
  kind: "percent",
  percent: null,
  fixedCents: null,
  currency: null,
  partnerId: null,
  productId: null,
  minMonthlySales: 0,
  capPerCustomerCents: null,
};

/**
 * An amount typed as the admin writes it ("12.50"), kept in the form in minor units (1250). Its
 * text is its own, so "12." stays while typing; it clears when the form does.
 */
function MoneyInput({
  cents,
  currency,
  onCents,
  ...props
}: Omit<ComponentProps<typeof Input>, "value" | "onChange"> & {
  cents: number | null;
  currency: string;
  onCents: (cents: number | null) => void;
}) {
  const [text, setText] = useState("");
  const shown = cents === null ? "" : text;
  return (
    <Input
      type="number"
      min={0}
      step={0.01}
      {...props}
      value={shown}
      onChange={(e) => {
        setText(e.target.value);
        onCents(e.target.value ? minorUnits(e.target.value, currency) : null);
      }}
    />
  );
}

const selectClass = "h-9 rounded-md border bg-transparent px-2 text-sm";

export default function AdminPage(props: Props) {
  const applications = props.partners.filter((p) => p.status === "pending").length;
  const toReview = props.sales.filter((s) => s.status === "pending").length;
  return (
    <>
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <Tabs defaultValue="events">
          <TabsList className="mb-4 w-full justify-start overflow-x-auto sm:w-auto">
            <TabsTrigger value="events">Events</TabsTrigger>
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
          <TabsContent value="events">
            <Events {...props} />
          </TabsContent>
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

function Partners({ partners, links }: Props) {
  const { run, busy, feedback } = useAction();
  const router = useRouter();
  const linksFor = links && {
    name: partners.find((p) => p.id === links.partnerId)?.name ?? "",
    links: links.links,
  };
  const change = (id: string, body: Omit<ResolveActionBody<"/admin?changePartner">, "id">) =>
    run(() => action("/admin?changePartner", { data: { id, ...body } }));
  const status = (id: string, value: "active" | "suspended") => change(id, { status: value });
  const update = change;
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
            <TableHead className="hidden md:table-cell">Renewals paid for</TableHead>
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
              <TableCell className="hidden md:table-cell">
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <Input
                    aria-label={`Months of renewals for ${p.name ?? p.email}`}
                    className="w-16"
                    type="number"
                    min={0}
                    max={1200}
                    placeholder="default"
                    defaultValue={p.recurringMonths ?? ""}
                    onBlur={(e) => {
                      // Empty: the program's default (AFFILIATES_RECURRING_MONTHS).
                      const text = e.currentTarget.value;
                      const months = text === "" ? null : Number(text);
                      if (months !== p.recurringMonths)
                        void update(p.id, { recurringMonths: months });
                    }}
                  />
                  months
                </div>
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
                    <DropdownMenuItem onClick={() => void run(() => viewAs(p.userId))}>
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
                        void router.visit(`/admin?links=${p.id}` as Href, { preserveScroll: true })
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
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void router.visit("/admin", { preserveScroll: true })}
            >
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

function Sales({ sales }: Props) {
  const { run, busy, feedback } = useAction();
  const decide = (id: string, status: "approved" | "rejected" | "pending") =>
    run(() => action("/admin?changeSale", { data: { id, status } }));
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

/** The events, each one's money, and booking another; organisers and venues to book them with. */
function Events({ events, choices, payees }: Props) {
  const book = useForm(
    "/admin?bookEvent",
    {
      name: "",
      description: "",
      venueId: "",
      organiserId: "",
      organiserPct: 15,
      priceCents: 0,
      startsAt: "",
      hours: 2,
    },
    { throwOnError: false, resetOnSuccess: true },
  );
  const organiser = useForm(
    "/admin?addOrganiser",
    { email: "" },
    { throwOnError: false, resetOnSuccess: true },
  );
  const venue = useForm(
    "/admin?addVenue",
    { name: "", location: "", capacity: 0, priceCents: 0, contactEmail: "" },
    { throwOnError: false, resetOnSuccess: true },
  );
  return (
    <div className="space-y-6">
      <Section
        title="Events"
        description="Money in is the tickets, not counting tax. Profit is that less the venue, the organiser's shares and the affiliates'. To break even: tickets still to sell, at what each has netted so far."
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Event</TableHead>
              <TableHead className="text-right">Sold</TableHead>
              <TableHead className="text-right">Money in</TableHead>
              <TableHead className="text-right">Venue</TableHead>
              <TableHead className="text-right">Organiser</TableHead>
              <TableHead className="text-right">Affiliates</TableHead>
              <TableHead className="text-right">Profit</TableHead>
              <TableHead className="text-right">To break even</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="whitespace-normal">
                  <div className="font-medium">{e.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {date(e.startsAt)}, {e.venue}, {e.organiser} ({e.organiserPct}%)
                    {!e.onSale && ", not on sale yet: the venue's payment hasn't gone"}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {e.sold} of {e.capacity}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(e.revenueCents, e.currency)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(e.venueCents, e.currency)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(e.organiserCents, e.currency)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(e.affiliateCents, e.currency)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(e.profitCents, e.currency)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {e.toBreakEven > e.capacity - e.sold
                    ? `${e.toBreakEven} (more than the places left)`
                    : e.toBreakEven}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <Section
        title="Book an event"
        description="Its venue is paid at once. Once that payment has gone, the event is on sale and every shop user is emailed."
      >
        <Form form={book} className="grid gap-2 sm:grid-cols-2">
          <Input placeholder="Name" required {...bind(book, "name")} />
          <Input placeholder="Description" required {...bind(book, "description")} />
          <select
            className={selectClass}
            aria-label="Venue"
            required
            value={book.data.venueId}
            onChange={(e) => book.setData("venueId", e.currentTarget.value)}
          >
            <option value="">Venue…</option>
            {choices.venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}: {v.capacity} places, {money(v.priceCents, v.currency)}
              </option>
            ))}
          </select>
          <select
            className={selectClass}
            aria-label="Organiser"
            required
            value={book.data.organiserId}
            onChange={(e) => book.setData("organiserId", e.currentTarget.value)}
          >
            <option value="">Organiser…</option>
            {choices.organisers.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name ?? o.email}
              </option>
            ))}
          </select>
          <Input
            type="number"
            min={0}
            max={100}
            step={0.5}
            aria-label="Organiser's percent"
            placeholder="Organiser's percent"
            required
            value={book.data.organiserPct}
            onChange={(e) => book.setData("organiserPct", Number(e.target.value))}
          />
          <MoneyInput
            aria-label="Ticket price"
            placeholder="Ticket price"
            required
            currency="usd"
            cents={book.data.priceCents || null}
            onCents={(cents) => book.setData("priceCents", cents ?? 0)}
          />
          <Input
            type="datetime-local"
            aria-label="Starts (UTC)"
            required
            value={book.data.startsAt}
            onChange={(e) => book.setData("startsAt", e.target.value)}
          />
          <Input
            type="number"
            min={0.5}
            max={24}
            step={0.5}
            aria-label="Hours"
            placeholder="Hours"
            required
            value={book.data.hours}
            onChange={(e) => book.setData("hours", Number(e.target.value))}
          />
          <Button type="submit" disabled={book.pending}>
            Book event
          </Button>
        </Form>
        {book.recentlySuccessful && (
          <p className="text-sm text-muted-foreground">
            Booked. The venue is being paid; the event goes on sale once that's gone.
          </p>
        )}
      </Section>

      <Section
        title="Organisers and venues"
        description="Each is paid through a shop user, found by their email, who signs in to set up payouts."
      >
        {(payees.length > 0 || choices.venues.length > 0) && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Who</TableHead>
                <TableHead>Is</TableHead>
                <TableHead>Paid through</TableHead>
                <TableHead>Payouts</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payees
                .filter((p) => p.role === "organiser")
                .map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{p.name ?? p.email}</TableCell>
                    <TableCell>Organiser</TableCell>
                    <TableCell>{p.email}</TableCell>
                    <TableCell>{p.payoutsSetUp ? "Stripe" : "By hand"}</TableCell>
                  </TableRow>
                ))}
              {choices.venues.map((v) => (
                <TableRow key={v.id}>
                  <TableCell>
                    {v.name}
                    <div className="text-xs text-muted-foreground">
                      {v.capacity} places, {money(v.priceCents, v.currency)}. {v.location}
                    </div>
                  </TableCell>
                  <TableCell>Venue</TableCell>
                  <TableCell>{v.contact}</TableCell>
                  <TableCell>
                    {payees.find((p) => p.email === v.contact)?.payoutsSetUp ? "Stripe" : "By hand"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Form form={organiser} className="flex flex-wrap gap-2">
          <Input
            type="email"
            placeholder="Organiser's email"
            required
            {...bind(organiser, "email")}
          />
          <Button type="submit" variant="outline" disabled={organiser.pending}>
            Add organiser
          </Button>
        </Form>
        {organiser.recentlySuccessful && (
          <p className="text-sm text-muted-foreground">Organiser added.</p>
        )}
        <Form form={venue} className="grid gap-2 sm:grid-cols-3">
          <Input placeholder="Venue name" required {...bind(venue, "name")} />
          <Input
            placeholder="Where (as attendees are told)"
            required
            {...bind(venue, "location")}
          />
          <Input
            type="number"
            min={1}
            aria-label="Places"
            placeholder="Places"
            required
            value={venue.data.capacity || ""}
            onChange={(e) => venue.setData("capacity", Number(e.target.value))}
          />
          <MoneyInput
            aria-label="Venue price"
            placeholder="Venue price"
            required
            currency="usd"
            cents={venue.data.priceCents || null}
            onCents={(cents) => venue.setData("priceCents", cents ?? 0)}
          />
          <Input
            type="email"
            placeholder="Contact's email"
            required
            {...bind(venue, "contactEmail")}
          />
          <Button type="submit" variant="outline" disabled={venue.pending}>
            Add venue
          </Button>
        </Form>
        {venue.recentlySuccessful && <p className="text-sm text-muted-foreground">Venue added.</p>}
      </Section>
    </div>
  );
}

function Payouts({ payouts }: Props) {
  const { run, busy, feedback } = useAction();
  return (
    <Section
      title="Payouts"
      description="Partners with Stripe Connect are paid by transfer; others are listed as manual, for you to pay."
    >
      <Button
        disabled={busy}
        onClick={() =>
          void run(
            () => action("/admin?runPayouts", { data: {} }),
            "Payouts queued. They appear here as each finishes.",
          )
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

function Rules({ rules, partners, payoutCurrency }: Props) {
  const { run, busy, feedback } = useAction();
  const rule = useForm("/admin?addRule", NO_RULE, { throwOnError: false, resetOnSuccess: true });
  const bonus = useForm(
    "/admin?bonus",
    { partnerId: "", commissionCents: 0, bonusNote: "" },
    { throwOnError: false, resetOnSuccess: true },
  );
  const kind = rule.data.kind;
  // What the rule's amounts are in: a fixed rule's own currency, else the payout currency.
  const ruleCurrency = rule.data.currency || payoutCurrency;
  const active = partners.filter((p) => p.status === "active");
  const nameOf = (id: string | null) =>
    id === null ? "Every partner" : (partners.find((p) => p.id === id)?.name ?? id);
  return (
    <div className="space-y-6">
      <Section
        title="Commission rules"
        description="Without rules each partner earns their own %. For each item the most specific rule wins: partner and product, then product, then partner, then everyone."
      >
        <Form form={rule} className="grid gap-2 sm:grid-cols-4">
          <select
            className={selectClass}
            aria-label="Pays"
            value={kind}
            onChange={(e) => {
              rule.setData("kind", e.currentTarget.value === "fixed" ? "fixed" : "percent");
              rule.setData("percent", null);
              rule.setData("fixedCents", null);
              rule.setData("currency", null);
            }}
          >
            <option value="percent">A percent of the sale</option>
            <option value="fixed">A fixed amount per unit</option>
          </select>
          {kind === "percent" ? (
            <Input
              type="number"
              min={0}
              max={100}
              step={0.1}
              placeholder="Percent"
              required
              value={rule.data.percent ?? ""}
              onChange={(e) => rule.setData("percent", Number(e.target.value))}
            />
          ) : (
            <>
              <MoneyInput
                placeholder="Amount"
                required
                currency={ruleCurrency}
                cents={rule.data.fixedCents}
                onCents={(cents) => rule.setData("fixedCents", cents)}
              />
              <Input
                placeholder="usd"
                maxLength={3}
                required
                {...bind(rule, "currency", { empty: null, as: (t) => t.toLowerCase() })}
              />
            </>
          )}
          <select
            className={selectClass}
            aria-label="Partner"
            value={rule.data.partnerId ?? ""}
            onChange={(e) => rule.setData("partnerId", e.currentTarget.value || null)}
          >
            <option value="">Every partner</option>
            {active.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name ?? p.email}
              </option>
            ))}
          </select>
          <Input
            placeholder="prod_… or price_… (empty: everything)"
            {...bind(rule, "productId", { empty: null, as: (t) => t.trim() })}
          />
          <Input
            type="number"
            min={0}
            placeholder="From sales this month"
            value={rule.data.minMonthlySales || ""}
            onChange={(e) => rule.setData("minMonthlySales", Number(e.target.value))}
          />
          <MoneyInput
            placeholder="Most per customer"
            currency={ruleCurrency}
            cents={rule.data.capPerCustomerCents}
            onCents={(cents) => rule.setData("capPerCustomerCents", cents)}
          />
          <Button type="submit" disabled={rule.pending}>
            Add rule
          </Button>
        </Form>
        {rule.recentlySuccessful && <p className="text-sm text-muted-foreground">Rule added.</p>}
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
                          () => action("/admin?retireRule", { data: { id: r.id } }),
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
        <Form form={bonus} className="grid gap-2 sm:grid-cols-4">
          <select
            className={selectClass}
            aria-label="Partner"
            required
            value={bonus.data.partnerId}
            onChange={(e) => bonus.setData("partnerId", e.currentTarget.value)}
          >
            <option value="">Partner</option>
            {active.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name ?? p.email}
              </option>
            ))}
          </select>
          <MoneyInput
            placeholder="Amount"
            required
            currency={payoutCurrency}
            cents={bonus.data.commissionCents || null}
            onCents={(cents) => bonus.setData("commissionCents", cents ?? 0)}
          />
          <Input maxLength={200} placeholder="Launch week" required {...bind(bonus, "bonusNote")} />
          <Button type="submit" disabled={bonus.pending || active.length === 0}>
            Add bonus
          </Button>
        </Form>
        {bonus.recentlySuccessful && (
          <p className="text-sm text-muted-foreground">
            Bonus added: approved, paid with the next payout.
          </p>
        )}
      </Section>
      {feedback}
    </div>
  );
}

function Performance({ stats }: Props) {
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

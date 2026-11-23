// The demo, written out: its people, and the program they're in. The fixtures both apps' seeds load
// (apps/shop/db/seed.ts makes the people shop accounts that sign in with DEMO_PASSWORD; db/seed.ts
// here makes the program) and the tests check against, so the demo, the seeds and the tests can't
// drift apart. Every value is literal; only the clicks behind the charts are generated (db/seed.ts,
// from a fixed seed), and nothing checks those exactly.
//
// Times are days before one instant: DEMO_NOW in tests and wherever the service's clock is pinned
// to it (src/clock.ts, AFFILIATES_NOW), else the moment the seed runs. The sales follow the
// program's own rules: approved HOLD_DAYS after they're made (unless flagged, or the partner's
// every sale is reviewed), and each payout paid what was approved by then.
//
// These logins are public: they're for showing the program, locally and on the demo deployment
// (README, "Demo data"). Nothing here is a real person.

export const DEMO_PASSWORD = "demo-password-2026";

interface DemoPerson {
  /** The shop user's id, which is also the partner's userId. */
  userId: string;
  name: string;
  email: string;
  role: "admin" | "user";
  partner?: {
    status: "active" | "pending" | "suspended";
    code: string;
    commissionPct: number;
    /** How much traffic they bring, relative to the others. */
    reach: number;
    /** Where their visitors come from. */
    sites: (string | null)[];
    reviewRequired?: boolean;
    promoCode?: string;
    application: string;
    joinedDaysAgo: number;
  };
}

export const demoPeople: DemoPerson[] = [
  { userId: "demo-admin", name: "Dana Reyes", email: "admin@demo.test", role: "admin" },
  {
    userId: "demo-maya",
    name: "Maya Chen",
    email: "maya@demo.test",
    role: "user",
    partner: {
      status: "active",
      code: "maya",
      commissionPct: 25,
      reach: 10,
      sites: ["www.youtube.com", "www.youtube.com", "x.com", null],
      promoCode: "MAYA10",
      application: "I review tools for small studios on YouTube (38k subscribers).",
      joinedDaysAgo: 120,
    },
  },
  {
    userId: "demo-leo",
    name: "Leo Martins",
    email: "leo@demo.test",
    role: "user",
    partner: {
      status: "active",
      code: "leo",
      commissionPct: 20,
      reach: 6,
      sites: ["newsletter.leomartins.test", "newsletter.leomartins.test", null],
      application: "A weekly newsletter on running a freelance business, about 9,000 readers.",
      joinedDaysAgo: 100,
    },
  },
  {
    userId: "demo-priya",
    name: "Priya Nair",
    email: "priya@demo.test",
    role: "user",
    partner: {
      status: "active",
      code: "priya",
      commissionPct: 20,
      reach: 4,
      sites: ["www.google.com", "priyanair.test", "www.linkedin.com", null],
      application: "I write tutorials on my blog and get most traffic from search.",
      joinedDaysAgo: 95,
    },
  },
  {
    userId: "demo-tom",
    name: "Tom Becker",
    email: "tom@demo.test",
    role: "user",
    partner: {
      status: "active",
      code: "tom",
      commissionPct: 20,
      reach: 3,
      sites: ["www.reddit.com", "news.ycombinator.com", null],
      reviewRequired: true,
      application: "I post in a few communities about developer tools.",
      joinedDaysAgo: 70,
    },
  },
  {
    userId: "demo-ana",
    name: "Ana Souza",
    email: "ana@demo.test",
    role: "user",
    partner: {
      status: "active",
      code: "ana",
      commissionPct: 15,
      reach: 2,
      sites: ["www.instagram.com", "www.tiktok.com", null],
      application: "Short videos about my studio setup on Instagram and TikTok.",
      joinedDaysAgo: 45,
    },
  },
  {
    userId: "demo-ken",
    name: "Ken Ito",
    email: "ken@demo.test",
    role: "user",
    partner: {
      status: "suspended",
      code: "ken",
      commissionPct: 20,
      reach: 2,
      sites: ["coupons.example.test", null],
      application: "Deals site.",
      joinedDaysAgo: 80,
    },
  },
  {
    userId: "demo-sam",
    name: "Sam Okafor",
    email: "sam@demo.test",
    role: "user",
    partner: {
      status: "pending",
      code: "sam",
      commissionPct: 20,
      reach: 0,
      sites: [],
      application: "I review productivity tools on YouTube, about 12k subscribers.",
      joinedDaysAgo: 2,
    },
  },
  {
    userId: "demo-lena",
    name: "Lena Vogel",
    email: "lena@demo.test",
    role: "user",
    partner: {
      status: "pending",
      code: "lena",
      commissionPct: 20,
      reach: 0,
      sites: [],
      application: "Podcast about design businesses; I'd mention the shop in episodes.",
      joinedDaysAgo: 1,
    },
  },
  // A shop customer who isn't a partner, to show the partner page's "apply" form.
  { userId: "demo-chris", name: "Chris Park", email: "chris@demo.test", role: "user" },
];

/** The instant the demo is dated from in tests (and wherever the clock is pinned): mid-month, noon UTC. */
export const DEMO_NOW = "2026-11-15T12:00:00.000Z";

/** Days a sale waits before it's approved (the service's AFFILIATES_HOLD_DAYS in the demo). */
export const HOLD_DAYS = 30;

/** The demo's products: Stripe product ids, names and prices. */
export const demoProducts = {
  proMonthly: { productId: "prod_demo_pro", name: "Pro", variant: "Monthly", cents: 2900 },
  proYearly: { productId: "prod_demo_pro", name: "Pro", variant: "Yearly", cents: 29000 },
  teamMonthly: { productId: "prod_demo_team", name: "Team", variant: "Monthly", cents: 9900 },
} as const;

interface DemoPayout {
  label: string;
  partner: string;
  daysAgo: number;
  amountCents: number;
}

/** The monthly payout runs, 72, 42 and 12 days ago: manual (no Stripe Connect in the demo). */
export const demoPayouts: DemoPayout[] = [
  { label: "maya_p72", partner: "maya", daysAgo: 72, amountCents: 7250 },
  { label: "maya_p42", partner: "maya", daysAgo: 42, amountCents: 8225 },
  { label: "maya_p12", partner: "maya", daysAgo: 12, amountCents: 8700 },
  { label: "leo_p42", partner: "leo", daysAgo: 42, amountCents: 8300 },
  { label: "leo_p12", partner: "leo", daysAgo: 12, amountCents: 406 },
  { label: "priya_p42", partner: "priya", daysAgo: 42, amountCents: 2500 },
  { label: "priya_p12", partner: "priya", daysAgo: 12, amountCents: 580 },
  { label: "ken_p12", partner: "ken", daysAgo: 12, amountCents: 580 },
];

interface DemoSale {
  label: string;
  partner: string;
  kind: "checkout" | "renewal" | "bonus" | "clawback";
  /** For checkouts and renewals. */
  product?: keyof typeof demoProducts;
  daysAgo: number;
  /** What it earns now: after any refund taken off it before it was paid. */
  commissionCents: number;
  /** What it earned before that refund, when one changed it. */
  grossCommissionCents?: number;
  status: "pending" | "approved" | "paid" | "refunded";
  /** The payout that paid it. */
  payout?: string;
  refundedCents?: number;
  fraudReason?: "self_email" | "self_ip";
  /** A renewal's first sale, or a clawback's refunded sale. */
  of?: string;
  customerEmail?: string;
  bonusNote?: string;
}

/**
 * Every sale, renewal, bonus and clawback. Commission: the partner's % of the price, except Team
 * plans, which pay a fixed $25 (demoRules).
 */
export const demoSales: DemoSale[] = [
  // Maya, 25%. Her yearly sale 60 days ago was 10% refunded after it was paid: a clawback.
  {
    label: "maya_1",
    partner: "maya",
    kind: "checkout",
    product: "proYearly",
    daysAgo: 110,
    commissionCents: 7250,
    status: "paid",
    payout: "maya_p72",
  },
  {
    label: "maya_2",
    partner: "maya",
    kind: "checkout",
    product: "proMonthly",
    daysAgo: 95,
    commissionCents: 725,
    status: "paid",
    payout: "maya_p42",
  },
  {
    label: "maya_3",
    partner: "maya",
    kind: "checkout",
    product: "teamMonthly",
    daysAgo: 80,
    commissionCents: 2500,
    status: "paid",
    payout: "maya_p42",
  },
  {
    label: "maya_launch",
    partner: "maya",
    kind: "bonus",
    daysAgo: 70,
    commissionCents: 5000,
    status: "paid",
    payout: "maya_p42",
    bonusNote: "Launch video",
  },
  {
    label: "maya_2_r1",
    partner: "maya",
    kind: "renewal",
    product: "proMonthly",
    of: "maya_2",
    daysAgo: 65,
    commissionCents: 725,
    status: "paid",
    payout: "maya_p12",
  },
  {
    label: "maya_4",
    partner: "maya",
    kind: "checkout",
    product: "proYearly",
    daysAgo: 60,
    commissionCents: 7250,
    status: "paid",
    payout: "maya_p12",
    refundedCents: 2900,
  },
  {
    label: "maya_5",
    partner: "maya",
    kind: "checkout",
    product: "proMonthly",
    daysAgo: 50,
    commissionCents: 725,
    status: "paid",
    payout: "maya_p12",
  },
  {
    label: "maya_6",
    partner: "maya",
    kind: "checkout",
    product: "proMonthly",
    daysAgo: 35,
    commissionCents: 725,
    status: "approved",
  },
  {
    label: "maya_2_r2",
    partner: "maya",
    kind: "renewal",
    product: "proMonthly",
    of: "maya_2",
    daysAgo: 35,
    commissionCents: 725,
    status: "approved",
  },
  {
    label: "maya_4_clawback",
    partner: "maya",
    kind: "clawback",
    of: "maya_4",
    daysAgo: 5,
    commissionCents: -725,
    status: "approved",
  },
  {
    label: "maya_7",
    partner: "maya",
    kind: "checkout",
    product: "teamMonthly",
    daysAgo: 20,
    commissionCents: 2500,
    status: "pending",
  },
  {
    label: "maya_8",
    partner: "maya",
    kind: "checkout",
    product: "proMonthly",
    daysAgo: 10,
    commissionCents: 725,
    status: "pending",
    fraudReason: "self_email",
    customerEmail: "maya@demo.test",
  },
  {
    label: "maya_9",
    partner: "maya",
    kind: "checkout",
    product: "proYearly",
    daysAgo: 3,
    commissionCents: 7250,
    status: "pending",
  },
  // Leo, 20%. One sale refunded in full, one 30% refunded before it was paid.
  {
    label: "leo_1",
    partner: "leo",
    kind: "checkout",
    product: "proYearly",
    daysAgo: 90,
    commissionCents: 5800,
    status: "paid",
    payout: "leo_p42",
  },
  {
    label: "leo_2",
    partner: "leo",
    kind: "checkout",
    product: "teamMonthly",
    daysAgo: 75,
    commissionCents: 2500,
    status: "paid",
    payout: "leo_p42",
  },
  {
    label: "leo_3",
    partner: "leo",
    kind: "checkout",
    product: "proMonthly",
    daysAgo: 55,
    commissionCents: 0,
    grossCommissionCents: 580,
    status: "refunded",
    refundedCents: 2900,
  },
  {
    label: "leo_4",
    partner: "leo",
    kind: "checkout",
    product: "proMonthly",
    daysAgo: 45,
    commissionCents: 406,
    grossCommissionCents: 580,
    status: "paid",
    payout: "leo_p12",
    refundedCents: 870,
  },
  {
    label: "leo_5",
    partner: "leo",
    kind: "checkout",
    product: "proYearly",
    daysAgo: 33,
    commissionCents: 5800,
    status: "approved",
  },
  {
    label: "leo_newsletter",
    partner: "leo",
    kind: "bonus",
    daysAgo: 10,
    commissionCents: 2500,
    status: "approved",
    bonusNote: "Newsletter feature",
  },
  {
    label: "leo_6",
    partner: "leo",
    kind: "checkout",
    product: "proMonthly",
    daysAgo: 12,
    commissionCents: 580,
    status: "pending",
  },
  // Priya, 20%.
  {
    label: "priya_1",
    partner: "priya",
    kind: "checkout",
    product: "teamMonthly",
    daysAgo: 85,
    commissionCents: 2500,
    status: "paid",
    payout: "priya_p42",
  },
  {
    label: "priya_2",
    partner: "priya",
    kind: "checkout",
    product: "proMonthly",
    daysAgo: 60,
    commissionCents: 580,
    status: "paid",
    payout: "priya_p12",
  },
  {
    label: "priya_3",
    partner: "priya",
    kind: "checkout",
    product: "proYearly",
    daysAgo: 25,
    commissionCents: 5800,
    status: "pending",
  },
  // Tom, 20%: every sale of his waits for an admin.
  {
    label: "tom_1",
    partner: "tom",
    kind: "checkout",
    product: "proMonthly",
    daysAgo: 60,
    commissionCents: 580,
    status: "pending",
  },
  {
    label: "tom_2",
    partner: "tom",
    kind: "checkout",
    product: "proYearly",
    daysAgo: 40,
    commissionCents: 5800,
    status: "pending",
  },
  {
    label: "tom_3",
    partner: "tom",
    kind: "checkout",
    product: "teamMonthly",
    daysAgo: 8,
    commissionCents: 2500,
    status: "pending",
  },
  // Ana, 15%.
  {
    label: "ana_1",
    partner: "ana",
    kind: "checkout",
    product: "proMonthly",
    daysAgo: 40,
    commissionCents: 435,
    status: "approved",
  },
  {
    label: "ana_2",
    partner: "ana",
    kind: "checkout",
    product: "proYearly",
    daysAgo: 15,
    commissionCents: 4350,
    status: "pending",
  },
  // Ken, 20%, suspended 20 days ago: two of his sales came from his own IP.
  {
    label: "ken_1",
    partner: "ken",
    kind: "checkout",
    product: "proMonthly",
    daysAgo: 70,
    commissionCents: 580,
    status: "paid",
    payout: "ken_p12",
  },
  {
    label: "ken_2",
    partner: "ken",
    kind: "checkout",
    product: "proMonthly",
    daysAgo: 50,
    commissionCents: 580,
    status: "pending",
    fraudReason: "self_ip",
  },
  {
    label: "ken_3",
    partner: "ken",
    kind: "checkout",
    product: "proYearly",
    daysAgo: 30,
    commissionCents: 5800,
    status: "pending",
    fraudReason: "self_ip",
  },
];

/** Commission rules: Maya earns 30% in a month she makes 15 sales; Team plans pay $25 for everyone. */
export const demoRules = [
  {
    label: "maya_tier",
    partner: "maya",
    kind: "percent" as const,
    percent: 30,
    minMonthlySales: 15,
  },
  {
    label: "team_fixed",
    partner: null,
    productId: "prod_demo_team",
    kind: "fixed" as const,
    fixedCents: 2500,
    currency: "usd",
  },
];

/** A seeded sale's customer: a renewal's or clawback's is its first sale's; a bonus has none. */
export function customerOf(sale: Pick<DemoSale, "label" | "kind" | "of" | "customerEmail">) {
  if (sale.kind === "bonus") return null;
  return sale.customerEmail ?? `${sale.of ?? sale.label}@customer.demo.test`;
}

/** A seeded sale's Stripe payment, by its label. */
export const paymentIntentOf = (label: string) => `pi_demo_${label}`;

/** A fixture's id, made from its label: the same on every load, as Rails' fixtures do it. */
export function fixtureId(label: string): string {
  // FNV-1a, four ways, for 32 hex digits, in a UUID's shape.
  let hex = "";
  for (let round = 0; round < 4; round++) {
    let h = 0x811c9dc5 ^ round;
    for (const ch of `${round}:${label}`) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
    hex += (h >>> 0).toString(16).padStart(8, "0");
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

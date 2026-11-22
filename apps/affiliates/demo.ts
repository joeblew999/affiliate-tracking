// The demo's people, shared by both apps' seeds so they line up: apps/shop/db/seed.ts makes each
// one a shop account (they can sign in, with DEMO_PASSWORD), and db/seed.ts here makes the
// partners among them and 90 days of their clicks, signups, sales and payouts.
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

// `vp run screens`: screenshots of every page of both apps, on a desktop and a phone, in .screens/.
// For looking at the design. Needs `vp run demo` (the demo data) and `vp run dev` running. It signs
// in as the demo's people (apps/affiliates/demo.ts): Maya (an active partner), Sam (waiting for
// approval), Chris (a customer who hasn't applied) and Dana (the admin).
import { mkdirSync, rmSync } from "node:fs";
import { chromium, type BrowserContext } from "playwright";
import { DEMO_PASSWORD } from "../apps/affiliates/demo";

const SHOP = "http://localhost:5173";
const AFFILIATES = "http://localhost:5174";
const OUT = ".screens";
const CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** The session cookie of a demo account, signed in on the shop. */
async function signIn(email: string): Promise<string> {
  const res = await fetch(`${SHOP}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: SHOP },
    body: JSON.stringify({ email, password: DEMO_PASSWORD }),
  });
  if (!res.ok) throw new Error(`sign in ${email}: ${res.status}; run \`vp run demo\` first`);
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

async function as(context: BrowserContext, cookie: string | null) {
  await context.clearCookies();
  for (const pair of (cookie ?? "").split("; ").filter(Boolean)) {
    const at = pair.indexOf("=");
    await context.addCookies([
      { name: pair.slice(0, at), value: pair.slice(at + 1), domain: "localhost", path: "/" },
    ]);
  }
}

rmSync(OUT, { recursive: true, force: true }); // only this run's screenshots
mkdirSync(OUT, { recursive: true });
const people = {
  maya: await signIn("maya@demo.test"),
  sam: await signIn("sam@demo.test"),
  chris: await signIn("chris@demo.test"),
  admin: await signIn("admin@demo.test"),
};
const browser = await chromium.launch();
for (const [device, viewport] of [
  ["desktop", { width: 1280, height: 860 }],
  ["phone", { width: 390, height: 844 }],
] as const) {
  const context = await browser.newContext({ viewport, userAgent: CHROME });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.error(`page error: ${err.message}`));
  const shot = async (name: string, url?: string) => {
    if (url) await page.goto(url, { waitUntil: "networkidle" });
    await page.screenshot({ path: `${OUT}/${name}-${device}.png`, fullPage: true });
    console.log(`${OUT}/${name}-${device}.png`);
  };
  await as(context, null);
  await shot("shop-signed-out", SHOP);
  await shot("service-signed-out", AFFILIATES);
  await as(context, people.chris);
  await shot("shop-signed-in", SHOP);
  await shot("partner-apply", AFFILIATES);
  await as(context, people.sam);
  await shot("partner-pending", AFFILIATES);
  await as(context, people.maya);
  await shot("partner", AFFILIATES);
  await as(context, people.admin);
  await page.goto(`${AFFILIATES}/admin`, { waitUntil: "networkidle" });
  for (const tab of await page.getByRole("tab").all()) {
    // The tab's name without its count ("Sales 5 pending": sales).
    const name = (await tab.textContent())?.trim().split(/\d/)[0]?.trim() ?? "tab";
    await tab.click();
    await page.waitForTimeout(300);
    await shot(`admin-${name.toLowerCase().replaceAll(/[^a-z]+/g, "-")}`);
  }
  await context.close();
}
await browser.close();

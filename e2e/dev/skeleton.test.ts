// Step 1 of plans/2026-11-22-01-void-service.md: the two apps, the bindings both ways, sign-in only
// in the shop, and the host-only API closed to everyone else.
import { expect, inject, test } from "vite-plus/test";
import { signUp } from "./helpers";
import { AFFILIATES } from "./setup";

const me = (cookie?: string) =>
  fetch(`${AFFILIATES}/api/me`, { headers: cookie ? { cookie } : {} }).then((r) => r.json());

test("the service knows who is signed in only by asking the shop", async () => {
  const alice = await signUp("Alice");
  expect(await me(alice.cookie)).toEqual({
    user: { id: alice.id, email: alice.email, name: "Alice", role: "user", impersonatedBy: null },
  });
  expect(await me()).toEqual({ user: null });
  expect(await me("better-auth.session_token=made-up")).toEqual({ user: null });
});

test("the host-only API needs the shop's token", async () => {
  const call = (token?: string) =>
    fetch(`${AFFILIATES}/api/host/signup`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { "x-affiliates-host-token": token } : {}),
      },
      body: JSON.stringify({ userId: "u1", ref: null }),
    });
  expect((await call()).status).toBe(401);
  expect((await call("wrong")).status).toBe(401);
  const ok = await call(inject("hostToken"));
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({ userId: "u1", referred: false });
});

test("the service's page shows the shop's signed-in user", async () => {
  const bob = await signUp("Bob");
  const html = await fetch(`${AFFILIATES}/`, { headers: { cookie: bob.cookie } }).then((r) =>
    r.text(),
  );
  expect(html).toContain(bob.email);
  expect(await fetch(`${AFFILIATES}/`).then((r) => r.text())).toContain("Sign in on");
});

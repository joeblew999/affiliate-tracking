// The host-only API (the shop's calls through its binding) is closed to everyone without the shop's
// token: the service also has a public address.
import { expect, inject, test } from "vite-plus/test";
import { AFFILIATES } from "./setup.ts";

test("the host-only API needs the shop's token", async () => {
  const call = (token?: string) =>
    fetch(`${AFFILIATES}/api/host/signup`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ userId: "u1", ref: null }),
    });
  expect((await call()).status).toBe(401);
  expect((await call("wrong")).status).toBe(401);
  const ok = await call(inject("hostToken"));
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({ userId: "u1", referred: false });
});

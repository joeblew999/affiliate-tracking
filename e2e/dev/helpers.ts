import { SHOP } from "./setup";

/** A fresh shop user, signed in: returns the session's Cookie header. */
export async function signUp(
  name = "Test User",
): Promise<{ cookie: string; email: string; id: string }> {
  const email = `${crypto.randomUUID()}@example.test`;
  const res = await fetch(`${SHOP}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: SHOP },
    body: JSON.stringify({ email, password: "example-password-123", name }),
  });
  if (!res.ok) throw new Error(`sign-up: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { user: { id: string } };
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return { cookie, email, id: body.user.id };
}

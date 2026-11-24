// A key for a Worker, from a hub that's running: made as a person would make it in the console,
// through the hub's Better Auth. Signs in as an admin (making the account the first time: the
// email has to be in the hub's ADMIN_EMAILS), finds the organization or makes it, and makes the key.
// `vp run key -- <hub's address> <admin email> <password> [key's name] [organization]` prints it.
// The key is shown once: the hub keeps only its hash.

export type KeyRequest = {
  /** The hub's address. */
  url: string;
  /** An admin of the hub (its ADMIN_EMAILS), and their password: set by the first call. */
  email: string;
  password: string;
  /** What the key is called, in the console. */
  name?: string;
  /** The organization's slug: made if it isn't there. */
  organization?: string;
};

export async function hubKey(request: KeyRequest): Promise<string> {
  const { url, email, password, name = "worker", organization = "default" } = request;
  let cookie = "";
  const call = async (path: string, body?: unknown) => {
    const response = await fetch(new URL(`/api/auth${path}`, url), {
      method: body === undefined ? "GET" : "POST",
      // Better Auth refuses a sign-in from no origin.
      headers: { "content-type": "application/json", origin: new URL(url).origin, cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = response.headers.getSetCookie().map((one) => one.split(";")[0]);
    if (set.length > 0) cookie = set.join("; ");
    return {
      ok: response.ok,
      status: response.status,
      body: (await response.json().catch(() => null)) as never,
    };
  };
  const signedIn =
    (await call("/sign-in/email", { email, password })).ok ||
    (await call("/sign-up/email", { name: "Admin", email, password })).ok;
  if (!signedIn)
    throw new Error(`${email} can't sign in to the hub at ${url} (is it in ADMIN_EMAILS?)`);

  const listed = await call("/organization/list");
  let org = ((listed.body ?? []) as { id: string; slug: string }[]).find(
    (one) => one.slug === organization,
  );
  if (!org) {
    const made = await call("/organization/create", { name: organization, slug: organization });
    if (!made.ok)
      throw new Error(`organization ${organization}: ${made.status} ${JSON.stringify(made.body)}`);
    org = made.body as { id: string; slug: string };
  }
  const key = await call("/api-key/create", { name, organizationId: org.id });
  const value = (key.body as { key?: string } | null)?.key;
  if (!key.ok || !value) throw new Error(`key ${name}: ${key.status} ${JSON.stringify(key.body)}`);
  return value;
}

if (import.meta.main) {
  // (`vp run key -- …` hands the `--` on too.)
  const [url, email, password, name, organization] = process.argv
    .slice(2)
    .filter((arg: string) => arg !== "--");
  if (!url || !email || !password)
    throw new Error("vp run key -- <hub's address> <admin email> <password> [name] [organization]");
  console.log(await hubKey({ url, email, password, name, organization }));
}

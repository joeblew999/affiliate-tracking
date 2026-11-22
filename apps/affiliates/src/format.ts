// Money and dates for the pages. Amounts are in a currency's minor units (cents); Intl knows how
// many decimals each currency has.
export function money(cents: number, currency: string): string {
  const code = currency.toUpperCase();
  const digits =
    new Intl.NumberFormat("en", { style: "currency", currency: code }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  return new Intl.NumberFormat(undefined, { style: "currency", currency: code }).format(
    cents / 10 ** digits,
  );
}

/** Minor units from what an admin types ("12.50" in usd → 1250). */
export function minorUnits(amount: string, currency: string): number {
  const digits =
    new Intl.NumberFormat("en", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).resolvedOptions().maximumFractionDigits ?? 2;
  return Math.round(Number(amount) * 10 ** digits);
}

export function date(ms: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(ms);
}

/** The message of an error from the service's API ({ error }), or of anything else thrown. */
export function messageOf(err: unknown): string {
  const data: unknown = err && typeof err === "object" ? Reflect.get(err, "data") : undefined;
  const fromApi: unknown =
    data && typeof data === "object" ? Reflect.get(data, "error") : undefined;
  if (typeof fromApi === "string") return fromApi;
  return err instanceof Error ? err.message : String(err);
}

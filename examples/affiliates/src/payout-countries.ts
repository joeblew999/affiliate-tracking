// The countries a partner's Stripe account can be in, to be paid by the payouts account. Stripe:
// a platform in the US, the UK, the EEA, Canada or Switzerland can pay connected accounts in any of
// those; anywhere else only its own country, unless Stripe agrees otherwise
// (docs.stripe.com/connect/cross-border-payouts-to-recipients, read 2026-11-23).
import { payoutsStripe } from "./stripe.ts";

/** The US, the UK, Canada, Switzerland, and the EEA (EU members, Iceland, Liechtenstein, Norway). */
const CROSS_BORDER = [
  "US",
  "GB",
  "CA",
  "CH",
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IS",
  "IE",
  "IT",
  "LV",
  "LI",
  "LT",
  "LU",
  "MT",
  "NL",
  "NO",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
];

/** By the payouts account's own country, as Stripe has it. */
export async function payoutCountries(): Promise<string[]> {
  const own = (await payoutsStripe().accounts.retrieveCurrent()).country?.toUpperCase();
  if (!own) return [];
  return CROSS_BORDER.includes(own) ? CROSS_BORDER : [own];
}
